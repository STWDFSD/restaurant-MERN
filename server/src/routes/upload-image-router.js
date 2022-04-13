const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuid4 } = require('uuid');
const fs = require('fs');
const ApiError = require('../util/ApiError');
// middlewares
const { verifyMyToken } = require('../middlewares/validate-token');
const { isAdmin } = require('../middlewares/isAdmin');

// Firebase
const { ref, getStorage, uploadBytes, getDownloadURL } = require('firebase/storage');
const firebaseConfig = require('../../FirebaseConfig');
const firebaseApp = require('firebase/app');
firebaseApp.initializeApp(firebaseConfig);
const storage = getStorage();

const metadata = {
    contentType: 'image/jpeg',
};

const uploadImageRouter = express.Router();

const storageMulter = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'uploads/');
    },

    filename: function(req, file, cb) {
        cb(null, uuid4() + path.extname(file.originalname));
    }
});


const uploader = multer({
    storage: storageMulter,
})

uploadImageRouter.post('/cache', verifyMyToken, isAdmin, uploader.array('itemImage', 7), (req, res, next) => {
    try {
        if(!req.files){
            return next(ApiError.badRequest('Invalid image data'));
        }

        console.log(req.files);
        return res.status(201).send({success: true, filesNames: req.files.map((f) => f.filename)})
    } catch (error) {
        console.error("Error in uploading images to cache::", error);
        return next(ApiError.apiInternal('Could not upload the files'));
    }
});


uploadImageRouter.post('/bucket', verifyMyToken, isAdmin, (req, res, next) => {
    try {
        let { files, location, existingImages = [] } = req.body;
        let fileURLs = [];

        console.log("FILES", files, existingImages);

        if(files.length === 0){
            console.log("Zero files");
            return res.status(201).send({success: true, fileURLs: [...existingImages, ...fileURLs]});
        }

        files.map(async (fileName, idx) => {
            const storageRef = ref(storage, `${location}/${uuid4()}.png`);
            let fileData = fs.readFileSync(`uploads/${fileName}`);
            
            await uploadBytes(storageRef, fileData, metadata)
                .then(async (snapshot) => {
                    await getDownloadURL(storageRef).then((url) => {
                        // fileURLs[fileName] = url;
                        fileURLs.push(url);
                    })
                    .catch((downloadErr) => {
                        console.error("Error getting download url:", downloadErr);
                    })
                })
                .catch((uploadErr) => {
                    console.error("Error uploading image:", uploadErr);
                })
            if(Object.keys(fileURLs).length === files.length){
                console.log("Returning image URLs", fileURLs);
                return res.status(201).send({success: true, fileURLs: [...existingImages, ...fileURLs]});
            }
        })

    } catch (error) {
        console.error("Error in uploading images::", error);
        return next(ApiError.apiInternal('Could not upload the file'));
    }
})

module.exports = uploadImageRouter;