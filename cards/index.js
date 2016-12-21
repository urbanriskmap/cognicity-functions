'use strict';

console.log('Loading function');

// Read constants from environment variables
const COGNICITY_URL = process.env.COGNICITY_URL;
const CARD_IMAGE_BUCKET = process.env.CARD_IMAGE_BUCKET;

const https = require('https');
const AWS = require('aws-sdk');
const s3 = new AWS.S3( { params: { Bucket: CARD_IMAGE_BUCKET } } );

// Check if the card exists
const retrieveCard = (cardId) => new Promise((resolve, reject) => {
  // Make a call to the URL to ensure that the card exists
  let url = [COGNICITY_URL,'cards',cardId].join('/');
  console.log(url);
  https.get(url, (res) => {
    // If status is 404 then no card so return null
    if (res.statusCode === 404) {
      resolve(null);
      return;
    }
    // If status is not 200 then we have a problem so return error
    if (res.statusCode !== 200) {
      reject(new Error('Problem retrieving card'));
      return;
    }
    // Try and parse the card record
    let body = ''
    res.on('data', (data) => {
      body += data;
    });
    res.on('end', () => {
      try {
        // Return the parsed card
        resolve(JSON.parse(body));
      } catch(e) {
        // OR reject with an error if the JSON could not be parsed
        console.log('malformed request', body);
        reject(new Error('malformed request: ' + body));
        return;
      }
    });
  }).on('error', (err) => {
    // Something bad happened so error
    console.log('Error, with: ' + err.message);
    reject(err);
    return;
  });
});

// Upload the image to S3
const uploadImage = (filename, contentType, base64Image) => {
  // Setup the S3 payload
  const params = {
    Key: filename,
    Body: new Buffer(base64Image,'base64'),
    ContentEncoding: 'base64',
    ContentType: contentType || 'image/png'
  };
  return s3.putObject(params).promise();
}

// Update card record with details of the image
const updateCardImage = (cardId, filename) => new Promise((resolve, reject) => {
  console.log('Patching card record with image_url');
  let payload = JSON.stringify({
    image_url: filename
  });
  console.log(payload);
  let options = {
    hostname: COGNICITY_URL.replace('https://',''),
    port: 443,
    path: `/cards/${cardId}`,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };
  console.log(options);
  let req = https.request(options, (res) => {
    // If image was successfully patched return true else return false
    console.log(res.statusCode);
    resolve(res.statusCode === 200);
    return;
  });
  req.on('error', (err) => {
    console.log(err);
    reject(err);
    return;
  });
  req.end(payload);
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
  if (!COGNICITY_URL || !CARD_IMAGE_BUCKET) return done({ message: 'Missing required environment variables' }, 500);
  if (!event.cardId) return done({ message: 'cardId is required' }, 400);
  if (!event.base64Image) return done({ message: 'base64Image is required' }, 400);

  // Check the card exists
  retrieveCard(event.cardId).then((card) => {
    if (!card) return done({message: `No card exists with cardId '${event.cardId}'`}, 404);
    if (card.report && card.report.image_url) return done({message: `This card already has an image '${event.cardId}'`}, 409);

    // Create filename from cardId and .gif if image/gif else .jpg for image/jpeg or image/png
    let filename = event.cardId + (event.contentType === 'image/gif' ? '.gif' : '.jpg');

    // Card exists and does not have an image so let's try and upload the image to S3
    uploadImage(filename, event.contentType, event.base64Image).then((res) => {
      console.log('Image upload successfully');

      // Finally, update the card with the image details
      updateCardImage(event.cardId, filename).then((updated) => {
        console.log('Updated card with image details');
        // Return a success
        if (updated) return done(null, 200, { cardId: event.cardId, updated: true });
        // Return an error giving details, we have an inconsistent state
        // TODO: Perhaps in the future we should back out the image if this happens?
        else return done({message: `An image was uploaded but the card record could not be updated for cardId '${event.cardId}'`}, 409);

      }).catch((err) => {
        console.log('An error occured updating the card image, ' + err);
        return done(err, 500);
      });

    }).catch((err) => {
      console.log('An error occured saving the image to S3, ' + err);
      return done(err, 500);
    });

  }).catch((err) => {
    console.log('An error occured retrieving the card, ' + err);
    return done(err, 500);
  });

};
