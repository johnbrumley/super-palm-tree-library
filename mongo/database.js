/************************************

 DATABASE STUFF (mongodb)

************************************/

// NOTES: probably make this into a singleton-like thing (don't want multiple database inits)
// also potentially switch to a constructor thing and add the init stuff to that

require('shelljs/global');
var mongoose = require('mongoose');
var fs = require('fs');
var mime = require('mime');
var database = {

  Document : null,
  docSchema : null,

  init : function(){

    // connect to database
    mongoose.connect('mongodb://localhost/test');

    var db = mongoose.connection;
    db.on('error', console.error.bind(console, 'connection error:')); 

    var self = this;
    // once connected, do stuff
    db.once('open', function(){
      // we're connected!
      console.log('database connection successful');

      self.docSchema = mongoose.Schema({
        title: String,
        page: Number,
        text: String
      });

      // Very Important! Make the title and text parameters "text" indices
      self.docSchema.index({text:'text'});

      // make sure to add any methods b4 defining the model
      self.docSchema.methods.test = function () {
        // code that might do something, can reference self with 'this.title' etc.
        console.log(this.title + " page: " + this.page + " complete");
      }

      // define document model
      self.Document = mongoose.model('Document', self.docSchema);

      // listAllDocs(Document);
      //searchDocs(Document, 'blade runner', function(results){
      //  console.log('first search')
      //});

      // create a dummy Doc and save it

      // var testDoc = new Document({title: 'My Second Document'});
      // console.log(testDoc.title);
      // saveDocument(testDoc);
    });
  }
}


/************************************

DATABASE FUNCTIONS

************************************/

database.listAllDocs = function ()
{
	this.Document.find(function (err, docs) 
  {
		if (err) return console.error(err);
		//console.log(docs);
	});
}

database.searchDocs = function (keyword, callback)
{
	console.time('searchTime');
  var items = [];
	// var r = new RegExp(keyword,'');
 //  
	// DocModel.find({ 'text': {$regex:r}}, function(err, results){
	// 	if (err) return console.error(err);
		
 //    // returns results array
	// 	if(results.length > 0) {
	// 		for (var nextResult of results){
	// 			//console.log('page '+nextResult);
 //        items.push(nextResult);
	// 		}
	// 	} else {
	// 		console.log('no results');
	// 	}
	// 	console.timeEnd('searchTime');
 //    //console.log(items);
 //    callback(items);
	// });

  this.Document.find(
        { $text : { $search : keyword } }, 
        { score : { $meta: "textScore" } }
    )
    .sort({ score : { $meta : 'textScore' } })
    .exec(function(err, results) {
      // console.log(results);
    if(results.length > 0) {
      for (var nextResult of results){
        items.push(nextResult);
        console.log(nextResult.title + ' : ' + nextResult.page + ' : ' + nextResult.text);
      }
    } else {
      console.log('no results');
    }
    console.timeEnd('searchTime');
    callback(items);
    });

}

database.addFile = function(file, callback){

  // First part !file.mimetype.startsWith( 'application/pdf' ) is for Node Express Upload File Object
  // Second is for Cron Job use of addFile as it a multer req.file object
  if ( !file.mimetype.startsWith( 'application/pdf' ) ) {
    return callback({
      text : 'The uploaded file must be a pdf'
    }, null);
  }

  // method 1: get number of pages and pdftotext each page, send stdout of pdftotext
  // directly to mongo,, upside: no extra files,, downside: if we wanted to return just 
  // the page of the pdf (i.e. if we wanted to display it) we would have to 
  // send the whole book

  // grab pdf info
  if(!which('pdfinfo')){
    return callback({
      messagge : 'server missing dependency. Install Brew then type "brew install poppler"'
    }, null);
  }

  // rename file
  cd(__dirname + '/data/uploads');
  // some issues with shell when '&' appears in filename, this is a temporary solution
  var fileString = file.originalname.replace('&','and');
  var folderString = fileString.slice(0,-4);
  mv(file.filename, fileString);

  console.log(fileString);

  var fileInfo = exec('pdfinfo ' + fileString).stdout;
  var numberOfPages = /Pages:\s+(\d+)/g.exec(fileInfo)[1];


  var pdfTitle = /Title:\s+(\w+.*)/g.exec(fileInfo);
  if(pdfTitle == null){
    console.log('[ NO TITLE DATA ] whoops this pdf does not have title metadata');
  }

  var pdfAuthor = /Author:\s+(\w+.*)/g.exec(fileInfo);
  console.log('author' + pdfAuthor);
  if(pdfAuthor == null){
    console.log('[ NO AUTHOR DATA ] whoops this pdf does not have author metadata');
  }

  // Check to see if PDF has metadata has Title, Author, (maybe these too --- subject, keywords)
  //var pdfMetaData = exec('pdftotext ' + fileString +' - | wc -l').stdout;
  //if(Number(pdfText) == 0){
  //  console.log('whoops this pdf is does not have metadata');
  //  //return res.status( 422 ).json ( { 
  //  //  error : 'please use adobe acrobat or PDFMtEd or another program to OCR your pdf.'
  //  //});
  //}

  console.time("pdftotext"); // on my comp this is averaging about 35s on 250pg book
  for(var p = 1; p < numberOfPages; p++){
    // save text to file, 
    // exec('pdftotext -f ' + p + ' -l ' + p + ' ' + fileString + ' ' + folderString + '-' + p + '.txt');
    // text to stdout
    var pageText = exec('pdftotext -f ' + p + ' -l ' + p + ' ' + fileString + ' -',{silent:true}).stdout;
    // then I would pass it to mongo
    var page = new this.Document({
      title: folderString,
      page: p,
      text: pageText
    });

    if(typeof this.Document !== 'undefined') this.saveDocument(page);

  }
  console.timeEnd("pdftotext");

  // now that the pages are all separated, we have to manually add the text for each page to our db
  // exec('pdftotext')

  // method 2: pdfseparate, then pdftotext each separate page

  cd(__dirname);

  return callback(null, file);
}

database.addFileCron = function(file, callback){

  // grab pdf info
  if(!which('pdfinfo')){
    return callback({
      messagge : 'server missing dependency. Install Brew then type "brew install poppler"'
    }, null);
  }
  console.log(file);
  // rename file
  cd(__dirname + '/data');
  // some issues with shell when '&' appears in filename, this is a temporary solution
  var fileString = file.replace('&','and');
  var folderString = fileString.slice(0,-4);
  mv(file, fileString);

  console.log(folderString);

  var fileInfo = exec('pdfinfo ' + fileString).stdout;
  var numberOfPages = /Pages:\s+(\d+)/g.exec(fileInfo)[1];


  var pdfTitle = /Title:\s+(\w+.*)/g.exec(fileInfo);
  if(pdfTitle == null){
    console.log('[ NO TITLE DATA ] whoops this pdf does not have title metadata');
  }

  var pdfAuthor = /Author:\s+(\w+.*)/g.exec(fileInfo);
  console.log('author' + pdfAuthor);
  if(pdfAuthor == null){
    console.log('[ NO AUTHOR DATA ] whoops this pdf does not have author metadata');
  }

  // Check to see if PDF has metadata has Title, Author, (maybe these too --- subject, keywords)
  //var pdfMetaData = exec('pdftotext ' + fileString +' - | wc -l').stdout;
  //if(Number(pdfText) == 0){
  //  console.log('whoops this pdf is does not have metadata');
  //  //return res.status( 422 ).json ( { 
  //  //  error : 'please use adobe acrobat or PDFMtEd or another program to OCR your pdf.'
  //  //});
  //}

  console.time("pdftotext"); // on my comp this is averaging about 35s on 250pg book
  for(var p = 1; p < numberOfPages; p++){
    // save text to file, 
    // exec('pdftotext -f ' + p + ' -l ' + p + ' ' + fileString + ' ' + folderString + '-' + p + '.txt');
    // text to stdout
    var pageText = exec('pdftotext -f ' + p + ' -l ' + p + ' ' + fileString + ' -',{silent:true}).stdout;
    // then I would pass it to mongo
    var page = new this.Document({
      title: folderString,
      page: p,
      text: pageText
    });

    if(typeof this.Document !== 'undefined') this.saveDocument(page);

  }
  console.timeEnd("pdftotext");
  console.log('made it!!! '+ __dirname+'/data/done/'+fileString);

  mv(fileString, __dirname+'/data/done/'+fileString);
                              //return res.status( 200 ).send( response );
  // now that the pages are all separated, we have to manually add the text for each page to our db
  // exec('pdftotext')

  // method 2: pdfseparate, then pdftotext each separate page

  cd(__dirname);

  return callback(null, file);
}


database.saveDocument = function (doc){
	doc.save(function (err, doc) {
		if (err) return console.error(err);
		// doc.test(); // maybe run the function if you feel like it
	});
}

database.clearSomeDocuments = function (searchTerm, callback) {
  var query = searchTerm + '.pdf';
  this.Document.remove({ title: query }, function (err) {
    if (err) return handleError(err);
    // removed!
  });

};

database.clearAllDocumentsFromDatabase = function (db, callback) {
   this.Document.remove({}, function (err) {
     if (err) return handleError(err);
     // removed!
   });
};

database.removeFileFromServer = function (req){
  var filePath = req.body.filePath;
  fs.unlinkSync(filePath);
  this.clearSomeDocuments(filePath);
}

database.dbInfo = function (callback) {
  database.Document.aggregate(
    { $group: 
      { _id: '$title', totalPages: { $sum: 1 } } 
    },
    function (err, results) {
      if (err) return handleError(err);
      console.log(results);
      callback(results);
    }
  );
}


// export my database module
module.exports = database;