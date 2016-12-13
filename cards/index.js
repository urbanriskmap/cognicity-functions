'use strict';

console.log('Loading function');

const https = require('https');
const AWS = require('aws-sdk');
const s3 = new AWS.S3( { params: { Bucket: process.env.CARD_IMAGE_BUCKET } } );

// Check if the card exists
const checkCardExists = (cardId) => new Promise((resolve, reject) => {
    // Make a call to the URL to ensure that the card exists
    let url = [process.env.COGNICITY_URL,'cards',cardId].join('/');
    console.log(url);
    https.get(url, (res) => {
        // If status is 200 then exists, otherwise it does not
        resolve(res.statusCode === 200);
    }).on('error', (err) => {
        console.log('Error, with: ' + err.message);
        return reject(err);
    });
});

// Upload the image to S3
const uploadImage = (cardId, contentType, base64Image) => {
    // Setup the S3 payload
    const params = {
        Key: [cardId, (contentType ? contentType.split('/')[1] : 'png')].join('.'),
        Body: new Buffer(base64Image,'base64'),
        ContentEncoding: 'base64',
        ContentType: contentType || 'image/png'
    };
    return s3.putObject(params).promise();
}

// TODO: Update card record with details of the image
const updateCardImage = (cardId) => new Promise((resolve, reject) => {
    resolve(true);
});

// Handle upload of an image for a given card, if exists add to S3 and update card record
exports.handler = (event, context, callback) => {

    // Helper function to format the response
    const done = (err, statusCode, res) => callback(err ? JSON.stringify({
        statusCode: statusCode,
        message: err.message
    }): null,
    {
        statusCode: statusCode,
        result: res
    });

    // Check the required parameters
    if (!event.cardId) return done({ message: 'cardId is required' }, 400);
    if (!event.base64Image) return done({ message: 'base64Image is required' }, 400);

    // We have the parameters we need, lets proceed
    try {
        // Check the card exists
        checkCardExists(event.cardId).then((exists) => {
            if (!exists) return done({message: `No card exists with cardId '${event.cardId}'`}, 404);

            // Card exists so let's try and upload the image to S3
            uploadImage(event.cardId, event.contentType, event.base64Image).then((res) => {
                console.log('Image upload successfully');

                // Finally, update the card with the image details
                updateCardImage(event.cardId, event.contentType).then((res) => {
                    console.log('Card updated with image');
                    return done(null, 200, { cardId: event.cardId, updated: true });
                });
            });
        })
    } catch (err) {
        // console.log('An error occured, ' + err);
        return done(err, 500);
    }
};
