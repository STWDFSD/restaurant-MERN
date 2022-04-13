const express = require("express");
const userRouter = express.Router();
const UserSchema = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ApiError = require('../util/ApiError');
const redisClient = require('../util/redisClient');
const { SESSION_TTL } = require('../util/sessionData');

// Middleware
const { userDataValidator } = require("../middlewares/user-validator");
const { verifyMyToken } = require("../middlewares/validate-token");
const { isSessionActive } = require('../middlewares/isSessionActive');
const { default: axios } = require("axios");

// @POST - User registration
userRouter.post("/signup", userDataValidator, (req, res, next) => {
    try {
        const {
            username,
            email,
            password,
            role = "re.user",
            auth_type = "normal",
            is_admin = false,
            profile_url = "",
        } = req.body;

        let salt = bcrypt.genSaltSync(10);
        let hashedPassword = bcrypt.hashSync(password, salt);

        let newUser = new UserSchema({
            username,
            email,
            password: hashedPassword,
            role,
            profile_url,
            auth_type,
            is_admin,
        });

        UserSchema.findOne({
            email: email,
        }).then((user) => {
            if (user) {
                return next(ApiError.badRequest('User already exists!'));
            }

            newUser
                .save()
                .then((saveUserResp) => {
                    return res.status(201).send({
                        success: true,
                        message: "User created successfully!",
                        user: saveUserResp,
                    });
                })
                .catch((saveUserErr) => {
                    return next(ApiError.badRequest("User can't be created"));
                });
        });
    } catch (error) {
        next(error);
    }
});

// @POST - User login
userRouter.post("/login", (req, res, next) => {
    try {
        let { email, password, auth_type = "normal" } = req.body;
        
        UserSchema.findOne({ email: email, auth_type })
            .then((user) => {
                if (user === null) {
                    return next(ApiError.badRequest('Invalid email or password'));
                }

                if (bcrypt.compareSync(password ?? "", user.password)) {
                    let token = jwt.sign(
                        { userId: user._id },
                        process.env.JWT_SECRET,
                    );
                    redisClient.set(user._id, 1);
                    redisClient.expire(user._id, SESSION_TTL);
                    return res.status(200).send({ success: true, token });
                }
                return next(ApiError.badRequest('Invalid email or password'));
            })
            .catch((err) => {
                console.error("Error while getting user", err);
                return next(ApiError.badRequest('Invalid email or password'));
            });
    } catch (error) {
        console.error("Some error", error);
        next(error);
    }
});

// @POST - Google Sign In
userRouter.post("/google/signin", (req, res, next) => {
    try {
        let { email, profile_url, username, authToken } = req.body;
        let salt = bcrypt.genSaltSync(10);
        let defaultEncryptedPassword = bcrypt.hashSync("Foodie$28", salt);

        UserSchema.updateOne(
            { email: email, is_deleted: false },
            {
                $set: {
                    email,
                    profile_url,
                    password: defaultEncryptedPassword,
                    is_admin: false,
                    username,
                    auth_type: "google",
                },
            },
            { upsert: true }
        )
            .then((user) => {
                redisClient.set(email, 1);
                redisClient.expire(email, SESSION_TTL);
                return res.status(201).send({ success: true, user });
            })
            .catch((err) => {
                return next(ApiError.badRequest('Please try again!'));
            });
    } catch (error) {
        console.error("Error in G Sign In", error);
        return next(ApiError.apiInternal('Error while signing with google'));
    }
});

// @POST - Facebook login
userRouter.post('/facebook/signin', (req, res, next) => {
    try {
        let {name: username, email, picture: profile_url, id, accessToken} = req.body;
        let salt = bcrypt.genSaltSync(10);
        let defaultEncryptedPassword = bcrypt.hashSync("Foodie$28", salt);

        axios.get(`https://graph.facebook.com/${id}/picture?redirect=false`, {
            access_token: accessToken
        })
        .then((profileResp) => {

            UserSchema.updateOne(
                { email: email, is_deleted: false },
                {
                    $set: {
                        email,
                        profile_url: profileResp.data.data.url,
                        password: defaultEncryptedPassword,
                        is_admin: false,
                        username,
                        auth_type: "facebook",
                    },
                },
                { upsert: true }
            )
                .then((user) => {
                    redisClient.set(email, 1);
                    redisClient.expire(email, SESSION_TTL);
                    return res.status(201).send({ success: true, user });
                })
                .catch((err) => {
                    return next(ApiError.badRequest('Please try again!'));
                });

        }).catch((profileErr) => {
            console.error("Profile Error:", profileErr);
            return next(ApiError.apiInternal('Error while fetching user profile'));
        })
    } catch (error) {
        console.error("Error in facebook signin:", error);
        return next(ApiError.apiInternal('Error while signing with facebook'));
    }
})

// @GET - Current user
userRouter.get("/currentuser", verifyMyToken, isSessionActive, (req, res) => {
    let auth_type = req.auth_type; // normal, google, facebook
    let userId = req.userId;

    const userFilters =
        auth_type === "normal" ? { _id: userId } : { email: req.email };

    UserSchema.findOne({ ...userFilters }, { password: 0 })
        .then((user) => {
            if (!user) {
                return res
                    .status(400)
                    .send({ success: false, message: "Invalid token" });
            }

            return res.status(200).send({ success: true, user });
        })
        .catch((userErr) => {
            console.error("Error while fetching user", userErr.message);
            return res
                .status(400)
                .send({ success: false, message: "Some error occured!" });
        });
});


// @GET - User exists or not
userRouter.get('/exists/:emailId', (req, res, next) => {
    try {
        let emailId = req.params.emailId;
        if(!emailId){
            return next(ApiError.badRequest('Invalid email id'));
        }

        UserSchema.findOne({email: emailId, is_deleted: false}, {password: 0})
            .then((user) => {
                if(user === null){
                    return next(ApiError.badRequest('User does not exists'));
                }
                return res.status(200).send({success: true, user});
            })
            .catch((err) => {
                console.error("Error occured while fetching user");
                return next(ApiError.apiInternal('Some error occured'));
            })

    } catch (error) {
        console.error("Error while checking user status", error);
        return next(ApiError.apiInternal('Error while checking user status'));
    }
})


// @PUT - Password change request
userRouter.put('/password', (req, res, next) => {
    try {
        let salt = bcrypt.genSaltSync(10);
        let encryptedPassword = bcrypt.hashSync(req.body.password, salt);

        UserSchema.updateOne({email: req.body.email, auth_type: "normal", is_deleted: false}, {$set: {password: encryptedPassword}})
            .then((updateResp) => {
                if(updateResp.modifiedCount === 1){
                    return res.status(200).send({success: true, message: "Password changed successfully!"});
                }
                return next(ApiError.badRequest('Password can\'t be changed'));
            })
            .catch((updateErr) => {
                console.log("Update password Error:", updateErr);
                return next(ApiError.badRequest('Password can\'t be changed'));
            })
    } catch (error) {
        console.error("Error while changing password", error);
        return next(ApiError.apiInternal('Error while changing password'));
    }
})


// @POST - Erase session
userRouter.post('/session/erase', (req, res, next) => {
    try {
        redisClient.del(req.body.user)
            .then((reply) => {
                console.log("Clear session response:", reply);
                return res.status(200).send({success: true, message: "Logged out"});
            })
            .catch((redisErr) => {
                return next(ApiError.apiInternal('Error occured in erasing session'));
            })
    } catch (error) {
        console.error("Error while erasing user session", error);
        return next(ApiError.apiInternal('Error while erasing user session'));
    }
})

module.exports = userRouter;
