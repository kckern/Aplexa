'use strict';
var dynasty = require('dynasty')({});
var Alexa = require('alexa-sdk');
var https = require('https');
var parseString = require('xml2js').parseString;
//Main Variables
var app = {
	const: {},
	config: {},
	state: {}
};
app.const = {
	title: 'Home Media Center',
	subtitle: 'Interface to Plex Music Library',
	cardContent: "Set up your own server. Plex.tv",
	ambient: 'https://kckern.info/wii.mp3',
	search: 'https://kckern.info/xbox.mp3'
};
app.sessions = {};
app.config = {
	plexToken: null,
	userID: null,
	base_url: null,
	port: null,
	music_library: null
};
app.state = {
	match: null,
	query: null,
	position: 0,
	queue: [],
	pre_shuffle: [],
	loop: false,
	shuffle: false,
	offsetInMilliseconds: 0,
	genre: null,
	idle: false,
	token: null,
	playlistTitle: null
};
app.defaultstate = Object.assign({}, app.state);


function tokenGen()
{
	return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function log(message,controller)
{
	var id = app.config.userID
	if(id===null) id = controller.event.session.user.accessToken;
	if(id===undefined) id = controller.event.session.user.accessToken;

	const querystring = require('querystring');     
	var postData = querystring.stringify({
    'message' : message,
    'user' : id
	});
	var options = {
	  hostname: "aplexa.netlab.cloud",
	  port: 443,
	  path: '/log.php',
	  method: 'POST',
	  headers: {
	       'Content-Type': 'application/x-www-form-urlencoded',
	       'Content-Length': postData.length
	     }
	};
	var req = https.request(options);
	req.write(postData);
	req.end();
}


function needsLoadState(controller,token)
{
	if(controller!==null) token = controller.event.session.user.accessToken;
	return  (app.state.queue.length === 0 || token!==app.config.userID);
}
function needsLoadConfig(controller)
{
	return  (app.config.plexToken === null || controller.event.session.user.accessToken!==app.config.userID);
}

//DB Access
var plexAppState = function() {
	return dynasty.table('plexAppState');
}
var plexAppConfig = function() {
	return dynasty.table('plexAppConfig');
}

var handlers = {
	'LaunchRequest': function() {
		if(needsLoadConfig(this)) return loadConfigs(this, "LaunchRequest");


		var speechOutput = "Welcome to Media Center. What would you like to do?";
		var repromptOutput = "You can ask to play an artist, and album, or a song.";
		this.response.speak(speechOutput).listen(repromptOutput);
		this.emit(':responseReady');
	},
	'PlayStream': function() {
		if(needsLoadConfig(this)) return loadConfigs(this, "PlayStream");
		app.state = Object.assign({}, app.defaultstate);
		saveState(this);
		var boundObj = this;
		var q = loadQuery(this.event.request);
		if(q === null) {
			this.response.speak("You need to ask for something to play.");
			this.emit(':responseReady');
			return false;
		}
		var pattern = "^(.*)? (?:from|off) (?:the )*(?:album |record )*(.{10,})";
		var myRegexp = new RegExp(pattern, "ig");
		var match = myRegexp.exec(q.speech);
		if(match !== null) {
			log([match[1]+" / "+match[2]]);
			return loadAlbumTracks(this, match[2], match[1]);
		}
		pattern = "^(.*)? (?:by) (?:the )*(?:artist|band|group|singer|act|troupe|performer)* *(.*)";
		myRegexp = new RegExp(pattern, "ig");
		match = myRegexp.exec(q.speech);
		if(match !== null) {
			log([match[1]+" / "+match[2]]);
			return loadArtistTracks(this, match[2], match[1]);
		}

  		log("========= Query: "+q.speech);
		var path = '/hubs/search?query=' + q.string + '&limit=30&sort=ratingCount:desc';
		fetchPlex(path, boundObj, function(xmlString, boundObj, q) {
			parseString(xmlString, processSearch.bind(boundObj));
		});
	},
	'AMAZON.HelpIntent': function() {
		// skill help logic goes here
		this.response.speak("Ask media center to play an artist, an album, or a song. ");
		this.emit(':responseReady');
	},
	'playQueue': function() {
		playQueue(this);
	},
	'SessionEndedRequest': function() {
		// no session ended logic needed
	},
	'ExceptionEncountered': function() {
		console.log("\n---------- ERROR ----------");
		console.log("\n" + JSON.stringify(this.event.request, null, 2));
		this.callback(null, null)
	},
	'Unhandled': function() {
		this.response.speak('Sorry. Something went wrong.');
		this.emit(':responseReady');
	},
	'AMAZON.NextIntent': function() {
		 if(needsLoadConfig(this)) return loadConfigs(this, "AMAZON.NextIntent");
		if(needsLoadState(this)) return loadState(this, "AMAZON.NextIntent");
		log("NextIntent ("+this.event.context.AudioPlayer.offsetInMilliseconds+") ",null);
		app.state.position++;
		if(typeof app.state.queue[app.state.position] === "undefined") {
			this.emit('AMAZON.StartOverIntent');
			return false;
		}
		var post = "."
		if(app.state.match !== "artist" && app.state.match !== "album") {
			post = ", by \"" + app.state.queue[app.state.position]['artist'] + "\", from the album \"" + app.state.queue[app.state.position]['album'] + "\".";
		}
		var message = "Next up is \"" + app.state.queue[app.state.position]['track'] + "\"" + post;
		message = message.replace(/&/ig, "and");
		saveState(this);
		this.response.speak(message).audioPlayerPlay('REPLACE_ALL', app.state.queue[app.state.position]['url'], app.state.queue[app.state.position]['url'], null, 0);
		this.emit(':responseReady');
	},
	'AMAZON.PreviousIntent': function() {
		 if(needsLoadConfig(this)) return loadConfigs(this, "AMAZON.PreviousIntent");
		if(needsLoadState(this)) return loadState(this, "AMAZON.PreviousIntent");
		if(typeof app.state.queue[app.state.position - 1] === "undefined") {
			this.response.speak("This is the first track.");
			this.emit(':responseReady');
			return false;
		}
		app.state.position--;
		var post = "."
		if(app.state.match !== "artist" && app.state.match !== "album") {
			post = ", by \"" + app.state.queue[app.state.position]['artist'] + "\", from the album \"" + app.state.queue[app.state.position]['album'] + "\".";
		}
		var message = "Back to \"" + app.state.queue[app.state.position]['track'] + "\"" + post;
		message = message.replace(/&/ig, "and");
		saveState(this);
		this.response.speak(message).audioPlayerPlay('REPLACE_ALL', app.state.queue[app.state.position]['url'], app.state.queue[app.state.position]['url'], null, 0);
		this.emit(':responseReady');
	},
	'AMAZON.CancelIntent': function() {
		this.response.speak("Media center closed.").audioPlayerStop();
	},
	'AMAZON.RepeatIntent': function() {
		 if(needsLoadConfig(this)) return loadConfigs(this, "AMAZON.RepeatIntent");
		if(needsLoadState(this)) return loadState(this, "AMAZON.RepeatIntent");
		app.state.position = 0;
		app.state.match = "repeat";
		playQueue(this);
	},
	'AMAZON.StopIntent': function() {
		if(needsLoadState(this)) return loadState(this, "AMAZON.CancelIntent");
	},
	'AMAZON.PauseIntent': function() {
		if(needsLoadState(this)) return loadState(this, "AMAZON.PauseIntent");
		app.state.offsetInMilliseconds = this.event.context.AudioPlayer.offsetInMilliseconds;
		saveState(this);
		this.response.audioPlayerStop();
		//this.response.speak("This track is now paused.").audioPlayerPlay('REPLACE_ALL', app.const.ambient, app.const.ambient, null, 0);
		app.state.idle = true;
		this.emit(':responseReady');
		//this.emit('AMAZON.StopIntent');
	},
	'AMAZON.ResumeIntent': function() {
		 if(needsLoadConfig(this)) return loadConfigs(this, "AMAZON.ResumeIntent");
		if(needsLoadState(this)) return loadState(this, "AMAZON.ResumeIntent");
		this.response.speak("Here's where we left off with: \"" + app.state.queue[app.state.position]['track'] + "\".").audioPlayerPlay('REPLACE_ALL', app.state.queue[app.state.position]['url'], app.state.queue[app.state.position]['url'], null, app.state.offsetInMilliseconds);
		this.emit(':responseReady');
	},
	'AMAZON.LoopOnIntent': function() {
		log("LOOP");
		 if(needsLoadConfig(this)) return loadConfigs(this, "AMAZON.LoopOnIntent");
		if(needsLoadState(this)) return loadState(this, "AMAZON.LoopOnIntent");
		app.state.loop = true;
		plexAppState().insert({
			userID: this.event.session.user.accessToken,
			Data: JSON.stringify(app.state)
		});
		this.response.speak("This track will now play on repeat.");
		this.emit(':responseReady');
	},
	'AMAZON.LoopOffIntent': function() {
		log("LOOPOFF");
		 if(needsLoadConfig(this)) return loadConfigs(this, "AMAZON.LoopOffIntent");
		if(needsLoadState(this)) return loadState(this, "AMAZON.LoopOffIntent");
		app.state.loop = false;
		saveState(this).
		this.response.speak("The playlist now will resume in sequence.");
		this.emit(':responseReady');
	},
	'AMAZON.ShuffleOnIntent': function() {
		 if(needsLoadConfig(this)) return loadConfigs(this, "AMAZON.ShuffleOnIntent");
		if(needsLoadState(this)) return loadState(this, "AMAZON.ShuffleOnIntent");
		app.state.shuffle = true;
		app.state.pre_queue = app.state.queue.slice(0);
		app.state.queue = shuffle(app.state.queue);
		app.state.position = 0;
		saveState(this);
		this.response.speak("Shuffling the music.").audioPlayerPlay('REPLACE_ALL', app.state.queue[app.state.position]['url'], app.state.queue[app.state.position]['url'], null, 0);
		this.emit(':responseReady');
	},
	'AMAZON.ShuffleOffIntent': function() {
		 if(needsLoadConfig(this)) return loadConfigs(this, "AMAZON.ShuffleOffIntent");
		if(needsLoadState(this)) return loadState(this, "AMAZON.ShuffleOffIntent");
		app.state.shuffle = false;
		app.state.queue = app.state.pre_queue.slice(0);
		app.state.position = 0;
		saveState(this);
		this.response.speak("Reverting to the orginal playlist order.").audioPlayerPlay('REPLACE_ALL', app.state.queue[app.state.position]['url'], app.state.queue[app.state.position]['url'], null, 0);
		this.emit(':responseReady');
	},
	'AMAZON.StartOverIntent': function() {
		 if(needsLoadConfig(this)) return loadConfigs(this, "AMAZON.StartOverIntent");
		if(needsLoadState(this)) return loadState(this, "AMAZON.StartOverIntent");
		app.state.position = 0;
		if(typeof app.state.queue[app.state.position] === "undefined") return false;
		var post = "."
		if(app.state.match !== "artist" && app.state.match !== "album") {
			post = ", by \"" + app.state.queue[app.state.position]['artist'] + "\", from the album \"" + app.state.queue[app.state.position]['album'] + "\".";
		}
		var message = "Starting over with \"" + app.state.queue[app.state.position]['track'] + "\"" + post;
		message = message.replace(/&/ig, "and");
		saveState(this);
		this.response.speak(message).audioPlayerPlay('REPLACE_ALL', app.state.queue[app.state.position]['url'], app.state.queue[app.state.position]['url'], null, 0);
		this.emit(':responseReady');
	},
	'PlayCommandIssued': function() {
		this.emit('AMAZON.ResumeIntent');
	},
	'PauseCommandIssued': function() {
		this.emit('AMAZON.PauseIntent');
	}
}
var audioEventHandlers = {
	'PlaybackStarted': function() {
		this.response.speak("Playback Started");
		this.emit(':responseReady');
	},
	'PlaybackFinished': function() {
		log("PlaybackFinished ("+this.event.context.AudioPlayer.offsetInMilliseconds+") ",null);
		this.response.speak("Playback Finished");
		this.emit(':responseReady');
	},
	'PlaybackStopped': function() {
		this.emit(':responseReady');
	},
	'PlexInfo': function() {
		this.response.speak("Track Info");
		this.emit(':responseReady');
	},
	'PlexArtist': function() {
		this.response.speak("I'll play more from this artist.");
		this.emit(':responseReady');
	},
	'PlexAlbum': function() {
		this.response.speak("I'll play this whole album");
		this.emit(':responseReady');
	},
	'PlaybackNearlyFinished': function() {

		if(this.event.context.AudioPlayer.offsetInMilliseconds<3000 && false) {

		log("PlaybackNearlyFinished Failed ("+this.event.context.AudioPlayer.offsetInMilliseconds+") ",null);
			return false;
			
		}
		else
		{


		  var lastToken = app.token;
		  var token = tokenGen();
		  app.token = token;



		if(needsLoadState(null,this.event.context.System.user.accessToken)) return plexAppState().find(this.event.context.System.user.accessToken).then(function(result) {
			if(result === undefined) {
				this.response.speak("Could not load the app state. ");
				this.emit(':responseReady');
				return false;
			}
			app.state = JSON.parse(result['Data']);
			if(app.state.loop === false) app.state.position++;
			if(typeof app.state.queue[app.state.position] === "undefined") {
				this.emit('SessionEndedRequest');
				return false;
			}
			plexAppState().insert({
				userID: this.event.context.System.user.accessToken,
				Data: JSON.stringify(app.state)
			});
			this.response.audioPlayerPlay('ENQUEUE', app.state.queue[app.state.position]['url'], token, lastToken, 0);
			this.emit(':responseReady');
		}.bind(this));
		if(app.state.loop === false) app.state.position++;
		if(typeof app.state.queue[app.state.position] === "undefined") {
			this.emit('SessionEndedRequest');
			return false;
		}
		plexAppState().insert({
			userID: this.event.context.System.user.accessToken,
			Data: JSON.stringify(app.state)
		});
		log(app.state.queue[app.state.position]['track']+": "+app.state.queue[app.state.position]['url'],null);
		this.response.audioPlayerPlay('ENQUEUE', app.state.queue[app.state.position]['url'], token, lastToken, 0);
		this.emit(':responseReady');
		}
	},
	'PlaybackFailed': function() {
		this.response.speak("Playback Failed");
		this.response.audioPlayerClearQueue('CLEAR_ENQUEUED');
		this.emit(':responseReady');
	}
}



function playQueue(controller) {
  if(needsLoadConfig(controller)) return loadConfigs(controller, "playQueue");
  var q = loadQuery(controller.event.request);
  var queue = app.state.queue;
  var message = null;
  if(typeof queue[app.state.position] === "undefined") app.state.position = 0;
  if(typeof queue[0] === "undefined") {
    controller.response.speak("Error with the playlist.");
    controller.emit(':responseReady');
  }
  if(app.state.match == "artist") {
    var num = "a bunch of";
    var s = 's';
    if(queue.length < 30) num = "" + queue.length;
    if(queue.length === 1) s = '';
    message = "Plex found " + num + " track" + s + " by \"" + queue[app.state.position]['artist'] + "\", starting with \"" + queue[app.state.position]['track'] + "\", from the album \"" + queue[app.state.position]['album'] + "\".";
  } else if(app.state.match == "playlist") {
    message = "Plex found the playlist \"" + app.state.playlistTitle + "\", which starts with \"" + queue[app.state.position]['track'] + "\", by \"" + queue[app.state.position]['artist'] + "\", from the album \"" + queue[app.state.position]['album'] + "\".";
  } else if(app.state.match == "genre") {
    message = "Plex found the \"" + app.state.genre + "\" musical genre, starting with \"" + queue[app.state.position]['track'] + "\", by \"" + queue[app.state.position]['artist'] + "\", from the album \"" + queue[app.state.position]['album'] + "\".";
  } else if(app.state.match == "album") {
    message = "Plex found the album '" + queue[app.state.position]['album'] + "', from \"" + queue[app.state.position]['artist'] + "\". The album begins with \"" + queue[app.state.position]['track'] + "\".";
  } else if(app.state.match == "artistTrack" || app.state.match == "albumTrack") {
    message = "Plex found \"" + queue[app.state.position]['track'] + "\", by \"" + queue[app.state.position]['artist'] + "\", from the album \"" + queue[app.state.position]['album'] + "\".";
  } else if(app.state.match == "repeat") {
    message = "Replaying \"" + queue[app.state.position]['track'] + "\".";
  } else {
    var num = "a bunch of";
    var s = 's';
    if(queue.length < 30) num = "" + queue.length;
    if(queue.length === 1) s = '';
    message = "Plex found " + num + " matching track" + s + ". Here is \"" + queue[app.state.position]['track'] + "\", by \"" + queue[app.state.position]['artist'] + "\", from the album \"" + queue[app.state.position]['album'] + "\".";
  }
  console.log(message);
  console.log(queue[app.state.position]['url']);

  log(message+"[/]"+queue[app.state.position]['url']);

  message = message.replace(/&/ig, "and");
  saveState(controller);


  var lastToken = app.token;
  var token = tokenGen();
  app.token = token;

  controller.response.speak(message).audioPlayerPlay('REPLACE_ALL', queue[app.state.position]['url'], token, lastToken, 0);
  controller.emit(':responseReady');
}
var processSearch = function(error, xmlObj) {
  app.state.position = 0;
  app.state.loop = false;
  var results = [];
  var cat_matches = {};
  for(const item of xmlObj.MediaContainer.Hub) {
    if(item.$.type === "track") {
      app.state.match = "tracks";
      results = gatherTracks(item.Track);
    }
    if(item.$.type === "genre" && parseInt(item.$.size, 0) > 0) {
      cat_matches["genre"] = item.Directory[0].$.id;
      app.state.genre = item.Directory[0].$.tag;
    }
    if(item.$.type === "playlist" && parseInt(item.$.size, 0) > 0) cat_matches["playlist"] = item.Playlist[0].$.key.replace(/[^0-9]+/g, '');
    if(item.$.type === "artist" && parseInt(item.$.size, 0) > 0) cat_matches["artist"] = item.Directory[0].$.key.replace(/[^0-9]+/g, '');
    if(item.$.type === "album" && parseInt(item.$.size, 0) > 0) cat_matches["album"] = item.Directory[0].$.key.replace(/[^0-9]+/g, '');
  }
  if('genre' in cat_matches) return loadGenre(this, cat_matches.genre);
  if('playlist' in cat_matches) return loadPlaylist(this, cat_matches.playlist);
  if('artist' in cat_matches) return loadArtist(this, cat_matches.artist);
  if('album' in cat_matches) return loadAlbum(this, cat_matches.album);
  if(results.length === 0) {
    var q = loadQuery(this.event.request);
    log("No Results.",this);
    this.response.speak("Nothing found for: '" + q.speech + "'. Try to play something else.").listen("Ask to play something else.");
    this.emit(':responseReady');
    return false;
  }
  app.state.queue = results;
  playQueue(this);
}
var processArtistORAlbum = function(error, xmlObj) {
  app.state.playlistTitle = xmlObj.MediaContainer.$.title;
  app.state.queue = gatherTracks(xmlObj.MediaContainer.Track);
  if(app.state.queue.length == 0) {
    var q = loadQuery(this.event.request);
    this.response.speak("No compatible tracks found for: '" + q.speech + "'. Try to play something else.").listen("Ask to play something else.");
    this.emit(':responseReady');
    return false;
  }
  playQueue(this);
}

function loadArtist(boundObj, key) {
  app.state.match = "artist";
  var path = '/library/metadata/' + key + '/grandchildren?limit=30&group=title&sort=ratingCount:desc';
  fetchPlex(path, boundObj, function(xmlString, boundObj, q) {
    parseString(xmlString, processArtistORAlbum.bind(boundObj));
  });
}

function loadAlbum(boundObj, key) {
  app.state.match = "album";
  var path = '/library/metadata/' + key + '/children?a=1';
  fetchPlex(path, boundObj, function(xmlString, boundObj, q) {
    parseString(xmlString, processArtistORAlbum.bind(boundObj));
  });
}

function loadPlaylist(boundObj, key) {
  app.state.match = "playlist";
  var path = '/playlists/' + key + '/items?a=1';
  fetchPlex(path, boundObj, function(xmlString, boundObj, q) {
    parseString(xmlString, processArtistORAlbum.bind(boundObj));
  });
}

function loadArtistTracks(boundObj, artist, query) {
  app.state.match = "artistTrack";
  var library = '/library';
  if(parseInt(app.config.music_library,0) >= 0) library = '/library/sections/' + app.config.music_library;
  var path = library + '/all?type=10&artist.title=' + encodeURI(artist) + '&track.title=' + encodeURI(query);
  fetchPlex(path, boundObj, function(xmlString, boundObj, q) {
    parseString(xmlString, processArtistORAlbum.bind(boundObj));
  });
}

function loadAlbumTracks(boundObj, album, query) {
  app.state.match = "albumTrack";
  var library = '/library';
  if(parseInt(app.config.music_library,0) >= 0) library = '/library/sections/' + app.config.music_library;
  var path = library + '/all?type=10&album.title=' + encodeURI(album) + '&track.title=' + encodeURI(query);
  fetchPlex(path, boundObj, function(xmlString, boundObj, q) {
    parseString(xmlString, processArtistORAlbum.bind(boundObj));
  });
}

function loadGenre(boundObj, key) {
  var library = '/library';
  app.state.match = "genre";
  if(parseInt(app.config.music_library,0) >= 0) library = '/library/sections/' + app.config.music_library;
  var path = library + '/all?artist.genre=' + key + '&type=10&sort=random&ratingCount%3E=2&limit=30';
  fetchPlex(path, boundObj, function(xmlString, boundObj, q) {
    parseString(xmlString, processArtistORAlbum.bind(boundObj));
  });
}

function gatherTracks(tracks) {
  var results = [];
  for(var i in tracks) {
    //if(!tracks[i].Media[0].Part[0].$.key.includes("mp3")) continue;
    results.push({
      "artist": tracks[i].$.grandparentTitle,
      "album": tracks[i].$.parentTitle,
      "track": tracks[i].$.title,
      "file": tracks[i].Media[0].Part[0].$.key,
      "url": "https://" + app.config.base_url + ":" + app.config.port + tracks[i].Media[0].Part[0].$.key + '?X-Plex-Token=' + app.config.plexToken
    });
  }
  return results;
}

function saveState(controller) {
  if(app.state.match === null) return false;
  if(app.state.queue.length === 0) return false;
  plexAppState().insert({
    userID: controller.event.session.user.accessToken,
    Data: JSON.stringify(app.state)
  });
}

function loadState(controller, next) {
	if(needsLoadConfig(controller)) return loadConfigs(controller,next,true);
	log("Loading State");
  return plexAppState().find(controller.event.session.user.accessToken).then(function(result) {
    if(result === undefined) {
      this.response.speak("Could not load the app state. ");
      this.emit(':responseReady');
      return false;
    }
    app.state = JSON.parse(result['Data']);
    this.emit(next);
  }.bind(controller));
}

function loadConfigs(controller, next ,loadStateToo) {
  return plexAppConfig().find(controller.event.session.user.accessToken).then(function(result) {
    if(result === undefined) {
      this.response.speak("Your Plex server cannot be located. Please link your account to this skill in the Alexa companion app.");
      this.emit(':responseReady');
      return false;
    }
	log("Loading Configs",controller);
    app.config = JSON.parse(result['Data']);
	app.state = Object.assign({}, app.defaultstate);
	if(loadStateToo===true) return loadState(controller,next);
    this.emit(next);
  }.bind(controller));
}
exports.handler = (event, context, callback) => {
  var alexa = Alexa.handler(event, context, callback);
  alexa.registerHandlers(handlers, audioEventHandlers);
  alexa.appId = 'amzn1.ask.skill.549fdcb5-c2a5-40b8-84a5-54062e84da1f';
  alexa.execute();
};
//Helper FUnctions
function shuffle(a) {
  var j, x, i;
  for(i = a.length - 1; i > 0; i--) {
    j = Math.floor(Math.random() * (i + 1));
    x = a[i];
    a[i] = a[j];
    a[j] = x;
  }
  return a; 
}

function loadQuery(request) {
  if(app.state.query !== null) return app.state.query;
  var q;
  if(typeof request.intent == "undefined") q = null;
  else if(typeof request.intent.slots.Query.value == "undefined") q = null;
  else q = request.intent.slots.Query.value;
  if(q == null) return q;
  q = q.replace(/\s*(the )*(playlist|album|artist)\s*/ig, "");
  var qobj = {
    speech: q.replace(/&/ig, "and").trim(),
    string: q.replace(/\s*\b(the|a|an)\b\s*/gi, ' ').replace(/\s+/g, "+").trim()
  }
  app.state.query = qobj;
  return qobj;
}

function fetchPlex(path, boundObj, callback) {
  var options = {
    hostname: app.config.base_url,
    port: app.config.port,
    path: path + '&X-Plex-Token=' + app.config.plexToken
  };
  var text;

  log("https://" + app.config.base_url + ":" + app.config.port + path + '&X-Plex-Token=' + app.config.plexToken);
  console.log("https://" + app.config.base_url + ":" + app.config.port + path + '&X-Plex-Token=' + app.config.plexToken);
  var request = https.get(options, function(res) {
    console.error("Got response: " + res.statusCode);
    res.setEncoding('utf8');
    var rawData = '';
    res.on('data', (chunk) => rawData += chunk);
    res.on('end', () => {
      callback(rawData, boundObj);
    });
  }).on('error', (e) => {
    log(`problem with request: ${e.message}`);
    boundObj.response.speak(`There was a problem talking to the plex server: ${e.message}`);
    boundObj.emit(':responseReady');
  });

  request.setTimeout(10000, function() {
  	log("Waited for 10 seconds")
  });
  request.setTimeout(15000, function() {
  	log(boundObj)
  	log("Waited for 15 seconds")
    boundObj.response.speak("The Plex server is taking too long to respond. Try again later.");
    boundObj.emit(':responseReady');
    return false;
  });
}