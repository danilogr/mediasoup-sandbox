
import * as config from './config';
import * as mediasoup from 'mediasoup-client';
import deepEqual from 'deep-equal';
import debugModule from 'debug';
import hark from 'hark'
import getUserMedia from 'getusermedia'


const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);
const log = debugModule('demo-app');
const warn = debugModule('demo-app:WARN');
const err = debugModule('demo-app:ERROR');

//
// export all the references we use internally to manage call state,
// to make it easy to tinker from the js console. for example:
//
//   `Client.camVideoProducer.paused`
//
export const myPeerId = uuidv4();
export let device,
           joined,
           localCam,
           localScreen,
           recvTransport,
           sendTransport,
           camVideoProducer,
           camAudioProducer,
           screenVideoProducer,
           screenAudioProducer,
           currentActiveSpeaker = {},
           currentNameMap = {},
           lastPollSyncData = {},
           consumers = [],
           pollingInterval,
           gazeX = 0,
           gazeY = 0,
           justUnchecked = false,
           markerInitialized = false,
           myVideoAdded = false,
           myRoomId,
           currentRoomMap = {},
           isBlur = false,
           isModerator = false,
           moderatorPeerID = '',
           wg_started = false,
           is_speaking = false;
var ar = null;


getUserMedia(function (err, stream) {
  if (err) throw err

  var options = {};
  var speechEvents = hark(stream, options);

  speechEvents.on('speaking', function () {
    sig('speaking', { src: 'participant_' + myPeerId, status: 'start' });
    console.log(currentNameMap['participant_' + myPeerId] + ' is speaking!');
  });

  speechEvents.on('stopped_speaking', function () {
    sig('speaking', { src: 'participant_' + myPeerId, status: 'stop' });
    console.log(currentNameMap['participant_' + myPeerId] + ' stopped speaking!');
  });
});

export async function showCoords(event) {
  var cX = event.clientX;
  var cY = event.clientY;
  gazeX = cX;//GazeData.GazeX;
  gazeY = cY;//GazeData.GazeY;
  var gaze = document.getElementById("gaze");
  cX -= gaze.clientWidth / 2;
  cY -= gaze.clientHeight / 2;
  gaze.style.left = cX + "px";
  gaze.style.top = cY + "px";
  console.log('clicked!!!');
}

function processGaze(GazeData) {
  var x_ = GazeData.docX;
  var y_ = GazeData.docY;
  gazeX = x_;//GazeData.GazeX;
  gazeY = y_;//GazeData.GazeY;

  // this.setState({ context: { x: x_, y: y_ } });

  var gaze = document.getElementById("gaze");
  x_ -= gaze.clientWidth / 2;
  y_ -= gaze.clientHeight / 2;

  // console.log(x_, y_);

  gaze.style.left = x_ + "px";
  gaze.style.top = y_ + "px";

}

export async function startCalibration() {
  $("#gaze").style.display = 'none';
  GazeCloudAPI.StartEyeTracking();
}

//
// entry point -- called by document.body.onload
//

export async function main() {
  console.log(`starting up ... my peerId is ${myPeerId}`);
  try {
    device = new mediasoup.Device();
  } catch (e) {
    if (e.name === 'UnsupportedError') {
      console.error('browser not supported for video calls');
      return;
    } else {
      console.error(e);
    }
  }

  // use sendBeacon to tell the server we're disconnecting when
  // the page unloads
  window.addEventListener('unload', () => sig('leave', {}, true));

  // ========== If use GazeCloud ==========
  GazeCloudAPI.OnCalibrationComplete = function () {
    console.log('gaze Calibration Complete');
    if (!isBlur) {
      $("#gaze").style.display = 'block';
    }
  }
  GazeCloudAPI.OnCamDenied = function () { console.log('camera access denied') }
  GazeCloudAPI.OnError = function (msg) { console.log('err: ' + msg) }
  GazeCloudAPI.UseClickRecalibration = true;
  GazeCloudAPI.OnResult = processGaze

  // ========== If use WebGazer ==========
  // webgazer.params.showVideoPreview = true;
  // window.applyKalmanFilter = true;
  // window.saveDataAcrossSessions = true;

  // await webgazer.setRegression('ridge') /* currently must set regression and tracker */
  //   //.setTracker('clmtrackr')
  //   .setGazeListener(function (data, clock) {
  //     //   console.log(data); /* data is an object containing an x and y key which are the x and y prediction coordinates (no bounds limiting) */
  //     //   console.log(clock); /* elapsed time in milliseconds since webgazer.begin() was called */
  //     if (data == null) {
  //       return;
  //     }
  //     var xprediction = data.x; //these x coordinates are relative to the viewport
  //     var yprediction = data.y; //these y coordinates are relative to the viewport

  //     gazeX = xprediction;
  //     gazeY = yprediction;

  //     var gaze = document.getElementById("gaze");
  //     xprediction -= gaze.clientWidth / 2;
  //     yprediction -= gaze.clientHeight / 2;

  //     gaze.style.left = xprediction + "px";
  //     gaze.style.top = yprediction + "px";

  //     // console.log(xprediction, yprediction);
  //     // console.log(elapsedTime);
  //   });
  // // webgazer.showPredictionPoints(true); /* shows a square every 100 milliseconds where current prediction is */
  // function hideVideoElements() {
  //   webgazer.showPredictionPoints(false);
  //   webgazer.showVideo(false);
  //   webgazer.showFaceOverlay(false);
  //   webgazer.showFaceFeedbackBox(false);
  //   //webgazer.showGazeDot(false);
  // };
  // hideVideoElements();
  // webgazer.loadGlobalData();

}

//
// meeting control actions
//

export async function beginWG() {
  if (!wg_started) {
    await webgazer.begin();
    wg_started = true;
    if (!isBlur) {
      $("#gaze").style.display = 'block';
    }
  }
}

export async function endWG() {
  if (wg_started) {
    await webgazer.end();
    wg_started = false;
    // if (!isBlur) {
    //   $("#gaze").style.display = 'block';
    // }
  }
}

export async function joinRoom() {
  if (joined) {
    return;
  }
  let name = $('#username').value;
  let passcode = $('#pwd').value;
  myRoomId = $('#roomname').value;
  let { result } = await sig('login', { username: name, roomname: myRoomId, pwd: passcode });
  
  if (result === 'room_denied') {
    alert("Wrong Room ID!");
    return;
  } else if (result === 'pwd_denied') {
    alert("Wrong passcode!");
    return;
  } else if (result === 'empty') {
    alert("Please enter your name!")
    return;
  } else if (result === 'mod_denied') {
    alert("Moderator exists! Please join as a participant!")
    return;
  } else if (result === 'M') {
    isModerator = true;
    moderatorPeerID = myPeerId;
  }

  log('join room');
  $('#join-control').style.display = 'none';

  $('#viz_tools').style.display = 'initial';
  $('#roomID').innerHTML = '<b>Room:' + myRoomId + '</b>';

  try {
    // signal that we're a new peer and initialize our
    // mediasoup-client device, if this is our first time connecting
    let { routerRtpCapabilities } = await sig('join-as-new-peer');
    if (!device.loaded) {
      await device.load({ routerRtpCapabilities });
    }
    joined = true;
    $('#leave-room').style.display = 'initial';
    document.getElementById("gaze").style.display = 'block';
  } catch (e) {
    console.error(e);
    return;
  }

  // super-simple signaling: let's poll at 1-second intervals
  pollingInterval = setInterval(async () => {
    let { error } = await pollAndUpdate();
    if (error) {
      clearInterval(pollingInterval);
      err(error);
    }
  }, 1000);

  if (isModerator) {
    sendAudioOnly();
  }
  else {
    console.log('Starting camera!!!')
    sendCameraStreams();
  }

}

export async function sendAudioOnly() {
  log('send camera streams');
  // $('#send-camera').style.display = 'none';

  // make sure we've joined the room and started our camera. these
  // functions don't do anything if they've already been called this
  // session
  await joinRoom();
  await startCamera();

  // create a transport for outgoing media, if we don't already have one
  if (!sendTransport) {
    sendTransport = await createTransport('send');
  }

  // start sending video. the transport logic will initiate a
  // signaling conversation with the server to set up an outbound rtp
  // stream for the camera video track. our createTransport() function
  // includes logic to tell the server to start the stream in a paused
  // state, if the checkbox in our UI is unchecked. so as soon as we
  // have a client-side camVideoProducer object, we need to set it to
  // paused as appropriate, too.

  // same thing for audio, but we can use our already-created
  camAudioProducer = await sendTransport.produce({
    track: localCam.getAudioTracks()[0],
    appData: { mediaTag: 'cam-audio' }
  });

}

export async function sendCameraStreams() {
  log('send camera streams');
  // $('#send-camera').style.display = 'none';

  // make sure we've joined the room and started our camera. these
  // functions don't do anything if they've already been called this
  // session
  await joinRoom();
  await startCamera();

  // create a transport for outgoing media, if we don't already have one
  if (!sendTransport) {
    sendTransport = await createTransport('send');
  }

  // start sending video. the transport logic will initiate a
  // signaling conversation with the server to set up an outbound rtp
  // stream for the camera video track. our createTransport() function
  // includes logic to tell the server to start the stream in a paused
  // state, if the checkbox in our UI is unchecked. so as soon as we
  // have a client-side camVideoProducer object, we need to set it to
  // paused as appropriate, too.
  camVideoProducer = await sendTransport.produce({
    track: localCam.getVideoTracks()[0],
    encodings: camEncodings(),
    appData: { mediaTag: 'cam-video' }
  });

  // 9/14 no need to check apuse
  // if (getCamPausedState()) {
  //   try {
  //     await camVideoProducer.pause();
  //   } catch (e) {
  //     console.error(e);
  //   }
  // }


  // same thing for audio, but we can use our already-created
  camAudioProducer = await sendTransport.produce({
    track: localCam.getAudioTracks()[0],
    appData: { mediaTag: 'cam-audio' }
  });

  // 9/14 no need to check pause
  // if (getMicPausedState()) {
  //   try {
  //     camAudioProducer.pause();
  //   } catch (e) {
  //     console.error(e);
  //   }
  // }

  // $('#stop-streams').style.display = 'initial';
  // showCameraInfo();
}

// TODO: change to require audio only in moderator mode
export async function startCamera() { 
  if (localCam) {
    return;
  }
  log('start camera');
  try {
    localCam = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
  } catch (e) {
    console.error('start camera error', e);
  }
}

// Not used!
export async function stopStreams() {
  if (!(localCam || localScreen)) {
    return;
  }
  if (!sendTransport) {
    return;
  }

  log('stop sending media streams');
  $('#stop-streams').style.display = 'none';

  let { error } = await sig('close-transport',
                            { transportId: sendTransport.id });
  if (error) {
    err(error);
  }
  // closing the sendTransport closes all associated producers. when
  // the camVideoProducer and camAudioProducer are closed,
  // mediasoup-client stops the local cam tracks, so we don't need to
  // do anything except set all our local variables to null.
  try {
    await sendTransport.close();
  } catch (e) {
    console.error(e);
  }
  sendTransport = null;
  camVideoProducer = null;
  camAudioProducer = null;
  screenVideoProducer = null;
  screenAudioProducer = null;
  localCam = null;
  localScreen = null;

  // update relevant ui elements
  $('#send-camera').style.display = 'initial';
  $('#share-screen').style.display = 'initial';
  $('#local-screen-pause-ctrl').style.display = 'none';
  $('#local-screen-audio-pause-ctrl').style.display = 'none';
  // showCameraInfo();
}

export async function leaveRoom() {
  if (!joined) {
    return;
  }

  log('leave room');
  $('#leave-room').style.display = 'none';

  // stop polling
  clearInterval(pollingInterval);

  // close everything on the server-side (transports, producers, consumers)
  let { error } = await sig('leave');
  if (error) {
    err(error);
  }

  // closing the transports closes all producers and consumers. we
  // don't need to do anything beyond closing the transports, except
  // to set all our local variables to their initial states
  try {
    recvTransport && await recvTransport.close();
    sendTransport && await sendTransport.close();
  } catch (e) {
    console.error(e);
  }
  recvTransport = null;
  sendTransport = null;
  camVideoProducer = null;
  camAudioProducer = null;
  screenVideoProducer = null;
  screenAudioProducer = null;
  localCam = null;
  localScreen = null;
  lastPollSyncData = {};
  consumers = [];
  joined = false;

  justUnchecked = false;
  markerInitialized = false;
  myVideoAdded = false;
  moderatorPeerID = '';
  isModerator = false;
  isBlur = false;


  // $('#viz1').checked = false;
  // changePeekaboo();
  // $('#viz2').checked = false;
  // changeSpotlight();
  // $('#viz3').checked = false;
  // changeSpy();

  $('#viz_tools').style.display = 'none';

  // hacktastically restore ui to initial state
  $('#join-control').style.display = 'initial';
  // $('#send-camera').style.display = 'initial';
  // $('#stop-streams').style.display = 'none';
  $('#remote-video').innerHTML = '';
  // $('#share-screen').style.display = 'initial';
  // $('#local-screen-pause-ctrl').style.display = 'none';
  // $('#local-screen-audio-pause-ctrl').style.display = 'none';
  // showCameraInfo();
  // updateCamVideoProducerStatsDisplay();
  // updateScreenVideoProducerStatsDisplay();
  updatePeersDisplay();
}

export async function subscribeToTrack(peerId, mediaTag) {
  log('subscribe to track', peerId, mediaTag);

  // create a receive transport if we don't already have one
  if (!recvTransport) {
    recvTransport = await createTransport('recv');
  }

  // if we do already have a consumer, we shouldn't have called this
  // method
  let consumer = findConsumerForTrack(peerId, mediaTag);
  if (consumer) {
    err('already have consumer for track', peerId, mediaTag)
    return;
  };

  // ask the server to create a server-side consumer object and send
  // us back the info we need to create a client-side consumer
  let consumerParameters = await sig('recv-track', {
    mediaTag,
    mediaPeerId: peerId,
    rtpCapabilities: device.rtpCapabilities
  });
  log('consumer parameters', consumerParameters);
  consumer = await recvTransport.consume({
    ...consumerParameters,
    appData: { peerId, mediaTag }
  });
  log('created new consumer', consumer.id);

  // the server-side consumer will be started in paused state. wait
  // until we're connected, then send a resume request to the server
  // to get our first keyframe and start displaying video
  while (recvTransport.connectionState !== 'connected') {
    log('  transport connstate', recvTransport.connectionState );
    await sleep(100);
  }
  // okay, we're ready. let's ask the peer to send us media
  await resumeConsumer(consumer);

  // keep track of all our consumers
  consumers.push(consumer);

  // ui
  console.log('after subscribe: add video here!!!!');
  await addVideoAudio(consumer);
  // updatePeersDisplay();
}

export async function resumeConsumer(consumer) {
  if (consumer) {
    log('resume consumer', consumer.appData.peerId, consumer.appData.mediaTag);
    try {
      await sig('resume-consumer', { consumerId: consumer.id });
      await consumer.resume();
    } catch (e) {
      console.error(e);
    }
  }
}

async function closeConsumer(consumer) {
  if (!consumer) {
    return;
  }
  log('closing consumer', consumer.appData.peerId, consumer.appData.mediaTag);
  try {
    // tell the server we're closing this consumer. (the server-side
    // consumer may have been closed already, but that's okay.)
    await sig('close-consumer', { consumerId: consumer.id });
    await consumer.close();

    consumers = consumers.filter((c) => c !== consumer);
    removeVideoAudio(consumer);
  } catch (e) {
    console.error(e);
  }
}

// utility function to create a transport and hook up signaling logic
// appropriate to the transport's direction
//
async function createTransport(direction) {
  log(`create ${direction} transport`);

  // ask the server to create a server-side transport object and send
  // us back the info we need to create a client-side transport
  let transport,
      { transportOptions } = await sig('create-transport', { direction });
  log ('transport options', transportOptions);

  if (direction === 'recv') {
    transport = await device.createRecvTransport(transportOptions);
  } else if (direction === 'send') {
    transport = await device.createSendTransport(transportOptions);
  } else {
    throw new Error(`bad transport 'direction': ${direction}`);
  }

  // mediasoup-client will emit a connect event when media needs to
  // start flowing for the first time. send dtlsParameters to the
  // server, then call callback() on success or errback() on failure.
  transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    log('transport connect event', direction);
    let { error } = await sig('connect-transport', {
      transportId: transportOptions.id,
      dtlsParameters
    });
    if (error) {
      err('error connecting transport', direction, error);
      errback();
      return;
    }
    callback();
  });

  if (direction === 'send') {
    // sending transports will emit a produce event when a new track
    // needs to be set up to start sending. the producer's appData is
    // passed as a parameter
    transport.on('produce', async ({ kind, rtpParameters, appData },
                                   callback, errback) => {
      log('transport produce event', appData.mediaTag);
      // we may want to start out paused (if the checkboxes in the ui
      // aren't checked, for each media type. not very clean code, here
      // but, you know, this isn't a real application.)
      let paused = false;

      // 9/14 no pause state detection
      // if (appData.mediaTag === 'cam-video') {
      //   paused = getCamPausedState();
      // } else if (appData.mediaTag === 'cam-audio') {
      //   paused = getMicPausedState();
      // }

      // tell the server what it needs to know from us in order to set
      // up a server-side producer object, and get back a
      // producer.id. call callback() on success or errback() on
      // failure.
      let { error, id } = await sig('send-track', {
        transportId: transportOptions.id,
        kind,
        rtpParameters,
        paused,
        appData
      });
      if (error) {
        err('error setting up server-side producer', error);
        errback();
        return;
      }
      callback({ id });
    });
  }

  // for this simple demo, any time a transport transitions to closed,
  // failed, or disconnected, leave the room and reset
  //
  transport.on('connectionstatechange', async (state) => {
    log(`transport ${transport.id} connectionstatechange ${state}`);
    // for this simple sample code, assume that transports being
    // closed is an error (we never close these transports except when
    // we leave the room)
    if (state === 'closed' || state === 'failed' || state === 'disconnected') {
      log('transport closed ... leaving the room and resetting');
      leaveRoom();
    }
  });

  return transport;
}

//
// polling/update logic
//

async function pollAndUpdate() {
  let { peers, activeSpeaker, nameMap, roomMap, mID, error } = await sig('sync');
  if (error) {
    return ({ error });
  }

  // always update bandwidth stats and active speaker display
  currentActiveSpeaker = activeSpeaker;
  currentNameMap = nameMap;
  currentRoomMap = roomMap;
  moderatorPeerID = mID;
  if (mID === '') {
    $('#moderator_status').innerHTML = 'Moderator not joined.'
  } else {
    $('#moderator_status').innerHTML = 'Moderater: ' + currentNameMap['participant_' + moderatorPeerID];
  }
  
  updateActiveSpeaker();
  // updateCamVideoProducerStatsDisplay();
  // updateScreenVideoProducerStatsDisplay();
  // updateConsumersStatsDisplay();


  // decide if we need to update tracks list and video/audio
  // elements. build list of peers, sorted by join time, removing last
  // seen time and stats, so we can easily do a deep-equals
  // comparison. compare this list with the cached list from last
  // poll.
  let thisPeersList = sortPeers(peers),
      lastPeersList = sortPeers(lastPollSyncData);
  if (!deepEqual(thisPeersList, lastPeersList)) {
    await updatePeersDisplay(peers, thisPeersList);
    autoSubscribe(thisPeersList);
  }

  // if a peer has gone away, we need to close all consumers we have
  // for that peer and remove video and audio elements
  for (let id in lastPollSyncData) {
    if (!peers[id]) {
      log(`peer ${id} has exited`);
      consumers.forEach((consumer) => {
        if (consumer.appData.peerId === id) {
          closeConsumer(consumer);
        }
      });
    }
  }

  // if a peer has stopped sending media that we are consuming, we
  // need to close the consumer and remove video and audio elements
  consumers.forEach((consumer) => {
    let { peerId, mediaTag } = consumer.appData;
    if (!peers[peerId].media[mediaTag]) {
      log(`peer ${peerId} has stopped transmitting ${mediaTag}`);
      closeConsumer(consumer);
    }
  });

  lastPollSyncData = peers;

  let {target, gazeMap} = await sendGazeDirection();
  updateGazeInfo(target, gazeMap);

  return ({}); // return an empty object if there isn't an error
}

function sortPeers(peers) {
  return  Object.entries(peers)
    .map(([id, info]) => ({id, joinTs: info.joinTs, media: { ...info.media }}))
    .sort((a,b) => (a.joinTs>b.joinTs) ? 1 : ((b.joinTs>a.joinTs) ? -1 : 0));
}

function findConsumerForTrack(peerId, mediaTag) {
  return consumers.find((c) => (c.appData.peerId === peerId &&
                                c.appData.mediaTag === mediaTag));
}

//
// -- user interface --
//


export async function autoSubscribe(sortedPeers) {
  for (let peer of sortedPeers) {
    if (peer.id === myPeerId) {
      continue;
    }
    if (currentRoomMap['participant_' + peer.id] !== myRoomId) {
      continue;
    }
    await sleep(1500);
    for (let [mediaTag, info] of Object.entries(peer.media)) {
      let consumer = findConsumerForTrack(peer.id, mediaTag);
      if (!consumer) {
        console.log('Here!!! subscribe!!!peer.id' + peer.id + mediaTag);
        await subscribeToTrack(peer.id, mediaTag);
      }
    }

  }
}

export async function updatePeersDisplay(peersInfo = lastPollSyncData,
                                         sortedPeers = sortPeers(peersInfo)) {
  log('room state updated', peersInfo);

  $('#available-tracks').innerHTML = '';
  if (camVideoProducer) {
    // let consumer = findConsumerForTrack(myPeerId, 'cam-video');
    // if (!consumer) {
    //   console.log('Here!!! subscribe!!!');
    //   await subscribeToTrack(myPeerId, 'cam-video');
    // }
    if (!myVideoAdded) {
      addMyVideoAudio();
      myVideoAdded = true;
    }
  }

}

function addMyVideoAudio() {
  if (isModerator) {
    return;
  }
  let div = document.createElement('div');
  div.setAttribute('class', 'participant_div');
  div.setAttribute('id', 'participant_' + myPeerId + '_div');
  div.style.height = document.body.clientHeight * 0.4 + 'px';
  let namediv = document.createElement('div');
  namediv.setAttribute('class', 'participant_name_div')
  let nametag = document.createElement('span');
  nametag.setAttribute('id', 'participant_' + myPeerId + '_name');
  nametag.innerHTML = currentNameMap['participant_' + myPeerId];
  namediv.appendChild(nametag);
  let el = document.createElement('video');
  // set some attributes on our audio and video elements to make
  // mobile Safari happy. note that for audio to play you need to be
  // capturing from the mic/camera
  el.setAttribute('id', 'participant_' + myPeerId);
  console.log('add video here!!!')
  el.setAttribute('playsinline', true);
  el.setAttribute('class', "participant_video");
  div.appendChild(el);
  div.appendChild(namediv);
  
  $('#remote-video').appendChild(div);
  el.srcObject = new MediaStream([localCam.getVideoTracks()[0]]);
  console.log('HERE self-video!!!');

  // el.consumer = consumer;
  // let's "yield" and return before playing, rather than awaiting on
  // play() succeeding. play() will not succeed on a producer-paused
  // track until the producer unpauses.
  el.play()
    .then(() => { })
    .catch((e) => {
      err(e);
    });

}

function addVideoAudio(consumer) {
  if (!(consumer && consumer.track)) {
    return;
  }
  // set some attributes on our audio and video elements to make
  // mobile Safari happy. note that for audio to play you need to be
  // capturing from the mic/camera
  let el = document.createElement(consumer.kind);
  if (consumer.kind === 'video') {
    let div = document.createElement('div');
    div.setAttribute('class', 'participant_div');
    div.setAttribute('id', 'participant_' + consumer.appData.peerId + '_div');
    div.style.height = document.body.clientHeight * 0.4 + 'px';
    let namediv = document.createElement('div');
    namediv.setAttribute('class', 'participant_name_div')
    let nametag = document.createElement('span');
    nametag.setAttribute('id', 'participant_' + consumer.appData.peerId + '_name');
    nametag.innerHTML = currentNameMap['participant_' + consumer.appData.peerId];
    namediv.appendChild(nametag);
    el.setAttribute('id', 'participant_' + consumer.appData.peerId);
    el.setAttribute('class', "participant_video");
    el.setAttribute('playsinline', true);
    div.appendChild(el);
    div.appendChild(namediv);
    $(`#remote-${consumer.kind}`).appendChild(div);
  } else {
    let div = document.createElement('div');
    el.setAttribute('playsinline', true);
    el.setAttribute('autoplay', true);
    div.appendChild(el);
    $(`#remote-${consumer.kind}`).appendChild(div);
  }
  
  el.srcObject = new MediaStream([consumer.track.clone()]);
  el.consumer = consumer;
  // let's "yield" and return before playing, rather than awaiting on
  // play() succeeding. play() will not succeed on a producer-paused
  // track until the producer unpauses.
  el.play()
    .then(()=>{})
    .catch((e) => {
      err(e);
    });

}

function removeVideoAudio(consumer) {
  document.querySelectorAll(consumer.kind).forEach((v) => {
    if (v.consumer === consumer) {
      v.parentNode.parentNode.removeChild(v.parentNode);
    }
  });
}

function updateActiveSpeaker() {

  $$('.participant_div').forEach((el) => {
    el.classList.remove('speaker');
  })
  if (moderatorPeerID !== '')
    $('#moderator_status').innerHTML = 'Moderator: ' + currentNameMap['participant_' + moderatorPeerID];

  if (currentActiveSpeaker.peerId) {
    if (currentActiveSpeaker.peerId === moderatorPeerID) {
      // display speaker status
      $('#moderator_status').innerHTML = 'Moderator ' + currentNameMap['participant_' + moderatorPeerID] + ' is speaking';
    }
    if ($(`#participant_${currentActiveSpeaker.peerId}_name`) !== null) {
      $(`#participant_${currentActiveSpeaker.peerId}_div`).classList.add('speaker');
    }
  }

}

function findAbsolutePosition(htmlElement) {
  var x = htmlElement.offsetLeft;
  var y = htmlElement.offsetTop;
  for (var x = 0, y = 0, el = htmlElement;
    el != null;
    el = el.offsetParent) {
    x += el.offsetLeft;
    y += el.offsetTop;
  }
  return {
    "left": x,
    "top": y
  };
}

export async function changeGaze() {
  if (isBlur) {
    isBlur = false;
    $$('.participant_video').forEach((el) => {
      el.classList.remove('drunk');
    })
    document.getElementById("gaze").style.display = 'block';
  } else {
    isBlur = true;
    $$('.participant_video').forEach((el) => {
      el.classList.add('drunk');
    })
    document.getElementById("gaze").style.display = 'none';
  }
  
}

export async function sendGazeDirection() {
  var x = gazeX;
  var y = gazeY;
  var videos = document.getElementsByTagName("video");
  let target = "";
  for (var vid of videos) {
    if (!vid.id.includes('participant')) {
      continue;
    }
    let {left, top} = findAbsolutePosition(vid);
    const left_ = vid.offsetLeft;
    const top_ = vid.offsetTop;
    // console.log("compare positions:", left, left_, top, top_);
    const w = vid.offsetWidth;
    const h = vid.offsetHeight;
    // console.log(left, top, left+w, top+h, 'x,y:', x, y);
    if (x >= left && x <= left + w && y >= top && y <= top + h) {
      target = vid.id;
      // break;
    }
    if (isBlur) {
      $('#' + vid.id).classList.add('drunk');
    }
  }
  if (isBlur) {
    if (target !== '')
      $('#' + target).classList.remove('drunk');
  }

  let viz_list = [$('#viz1').checked, $('#viz2').checked, $('#viz3').checked]
  // console.log('target is ' + target);
  if (isModerator)
    var { gazeMap } = await sig('gaze', { src: '', tar: target, vl: [] });
  else
    var { gazeMap } = await sig('gaze', { src: 'participant_' + myPeerId, tar: target, vl: viz_list });
  // console.log(gazeMap);
  let ts = new Date(Date.now());
  let timeString = ts.toLocaleTimeString("en-US");
  $('#time').innerHTML = timeString;
  return {target, gazeMap};
}

export async function changePeekaboo() {
  if (!isModerator) {
    $('#viz1').checked = true;
    return;
  }

  // if (!$('#viz1').checked) {
  //   $('#viz1').checked = true;
  //   return;
  // }

  // remove all viz if ckecked -> unchecked
  if (!$('#viz1').checked) {
    $$('.x_icon_style').forEach((el) => {
      el.remove();
    });
  } else if ($('#viz1').checked && isModerator) {
    $('#viz1').checked = false;
  }
}

function updatePeekaboo(gazeDistribution, gazeMap_) {
  $$('.x_icon_style').forEach((el) => {
    el.remove();
  });

  for (var key in gazeDistribution) {
    const gaze = gazeMap_[key];
    if (gaze === 'participant_' + myPeerId) {
      var img = document.createElement('img');
      img.setAttribute('class', 'x_icon_style');
      img.setAttribute('src', 'x_icon.png');
      $(`#${key}_name`).parentNode.appendChild(img);
    }
  }
}

export async function changeSpotlight() {
  if (!isModerator) {
    $('#viz2').checked = true;
    return;
  }

  // if ($('#viz2').checked) {
  //   $('#viz2').checked = false;
  //   return;
  // }
  // remove all viz if ckecked -> unchecked
  if (!$('#viz2').checked) {
    justUnchecked = true;
  }
}

function updateSpotlight(distributionMap) {
  for (var key in distributionMap) {
    if ($('#' + key) !== null) {
      $('#' + key).style.opacity = 0.3 + distributionMap[key] * 0.7;
      setTimeout(() => {
        $('#' + key).classList.add("opacity_transition");
      }, 50);
    }
  }
}

export async function changeSpy() {
  if (!isModerator) {
    $('#viz3').checked = true;
    return;
  }

  // if (!$('#viz3').checked) {
  //   $('#viz3').checked = true;
  //   return;
  // }
  // remove all viz if ckecked -> unchecked
  if (!$('#viz3').checked) {
    // if ($('#svg-canvas') !== null) {
    //   $('#svg-canvas').remove();
    // }
    exit_curve();
  }
}

function updateSpy(target, gazeMap_, distributionMap) {
  // if ($('#svg-canvas') !== null) {
  //   $('#svg-canvas').innerHTML = '';
  //   markerInitialized = false;
  // }
  exit_curve();
  if (target in gazeMap_) {
    const gaze = gazeMap_[target];
    if ((gaze in distributionMap) && (gaze !== target)) {
      connectDivs($(`#${target}_div`), $(`#${gaze}_div`), '#ff5a00', 4);
      // $('#' + target + '_name').innerHTML = currentNameMap[target] + ' -> ' + currentNameMap[gaze];
    }
  }
}

function updateGazeInfo(target, gazeMap) {
  const gazeDistribution = {};
  for (var key in lastPollSyncData) {
    if (currentRoomMap['participant_' + key] === myRoomId && key !== moderatorPeerID)
      gazeDistribution['participant_' + key] = 0
  }
  const total = Object.keys(gazeDistribution).length;

  for (var key in gazeDistribution) {
    const gaze = gazeMap[key];

    if ((gaze === '') || (gaze === key)) {
      // console.log('here!!!!');
      continue;
    }
    if (gaze in gazeDistribution) {
      gazeDistribution[gaze] += 1.0 / (total - 1);
    } 
    // else {
    //   gazeDistribution[gaze] = 0;
    // }
  }

  /*
    Plot gaze follower
  */
  if ($(`#viz1`).checked) {
    updatePeekaboo(gazeDistribution, gazeMap);
  }
  /*
    Plot gaze distribution
  */
  if ($(`#viz2`).checked) {
    updateSpotlight(gazeDistribution);
  }
  /*
    Plot target's gaze direction
  */
  if ($(`#viz3`).checked) {
    updateSpy(target, gazeMap, gazeDistribution);
  }

  if (justUnchecked) {
    for (var key in gazeDistribution) {
      if ($('#' + key) !== null) {
        $('#' + key).style.opacity = 1;
        setTimeout(() => {
          ('#' + key).classList.add("opacity_transition");
        }, 50);
      }
    }
    justUnchecked = false;
  }

}

function createSVG() {
  var svg = document.getElementById("svg-canvas");
  if (null == svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg",
      "svg");
    svg.setAttribute('id', 'svg-canvas');
    svg.setAttribute('style', 'position:absolute;top:0px;left:0px;pointer-events:none;');
    svg.setAttribute('width', document.body.clientWidth);
    svg.setAttribute('height', document.body.clientHeight);
    svg.setAttributeNS("http://www.w3.org/2000/xmlns/",
      "xmlns:xlink",
      "http://www.w3.org/1999/xlink");
    document.body.prepend(svg);
  }
  return svg;
}

function drawCircle(x, y, radius, color) {
  var svg = createSVG();
  var shape = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  shape.setAttributeNS(null, "cx", x);
  shape.setAttributeNS(null, "cy", y);
  shape.setAttributeNS(null, "r", radius);
  shape.setAttributeNS(null, "fill", color);
  svg.appendChild(shape);
}

function connectDivs(elem1, elem2, color, tension) {
  var pos1 = findAbsolutePosition(elem1);
  var x1 = pos1.left;
  var y1 = pos1.top;
  var pos2 = findAbsolutePosition(elem2);
  var x2 = pos2.left;
  var y2 = pos2.top;
  var coeff = 1;
  if (y1 === y2) {
    // same line
    // top
    if (y1 < document.body.clientHeight * 0.4) {
      x1 += (elem1.offsetWidth / 2);
      y1 += elem1.offsetHeight;
      x2 += (elem2.offsetWidth / 2);
      y2 += elem2.offsetHeight;
    } else { // bottom
      x1 += (elem1.offsetWidth / 2);
      x2 += (elem2.offsetWidth / 2);
      coeff = -1;
    }
  } else if (y1 < y2) {
    // 1 is top, 2 is btm
    x1 += (elem1.offsetWidth / 2);
    y1 += elem1.offsetHeight;
    x2 += (elem2.offsetWidth / 2);
    coeff = -1;
  } else {
    // 1 is btm, 2 is top
    x1 += (elem1.offsetWidth / 2);
    x2 += (elem2.offsetWidth / 2);
    y2 += elem2.offsetHeight;
  }

  // var width = x2 - x1;
  // var height = y2 - y1;
  // drawCircle(x1, y1, 5, color);
  // drawCircle(x2, y2, 3, color);
  // createTriangleMarker(color);

  drawCurvedLine(x1, y1, x2, y2, color, tension, coeff);
}

function drawCurvedLine(x1, y1, x2, y2, color, tension, coeff) {
  // var svg = createSVG();
  // var shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  var xcoeff = 1 / coeff;//-coeff;
  if (y2 === y1) {
    // y2 = y2 + gap * coeff;
    if (x1 > x2) xcoeff = -1 / coeff
    var delta = 20 * tension;
    var hx1 = x1;
    var hy1 = y1 + delta * coeff;
    var hx2 = x2 - xcoeff * delta * coeff;
    var hy2 = y2 + delta * coeff;
    var path = "M " + x1 + " " + y1 +
      " C " + hx1 + " " + hy1 + " "
      + hx2 + " " + hy2 + " "
      + x2 + " " + y2;
  } else {
    // y2 += gap * coeff;
    if (x1 < x2) xcoeff = -1 / coeff
    var delta = 20 * tension;
    if (x1 === x2) {
      var delta = 0;
    }
    var hx1 = x1;
    var hy1 = y1 - delta * coeff;
    var hx2 = x2 + xcoeff * delta * coeff;
    var hy2 = y2 + delta * coeff;
    var path = "M " + x1 + " " + y1 +
      " C " + hx1 + " " + hy1 + " "
      + hx2 + " " + hy2 + " "
      + x2 + " " + y2;
  }
  var ya = new yarrow.Yarrow();
  ar = ya.arrow({
    x1: 0,
    y1: 0,
    x2: document.body.clientWidth,
    y2: document.body.clientHeight,
    d: path,
    duration: 500,     // arrow duration
    duration1: 125,     // tip1 duration
    delay2: 500 + 125, // tip2 delay
    duration2: 125,      // tip2 duration

    arrowStyles: {
      'stroke': color,//'#ff5a00',
      'stroke-width': 10
    },

  }).render()

}

function exit_curve() {
  // ar.render()
  if (ar !== null) {
    ar.dispose(250, 0);
    ar = null;
  }
}

function createTriangleMarker(color) {
  if (markerInitialized)
    return;
  markerInitialized = true;
  var svg = createSVG();
  var defs = document.createElementNS('http://www.w3.org/2000/svg',
    'defs');
  svg.appendChild(defs);

  var marker = document.createElementNS('http://www.w3.org/2000/svg',
    'marker');
  marker.setAttribute('id', 'triangle');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', 0);
  marker.setAttribute('refY', 5);
  marker.setAttribute('markerUnits', 'strokeWidth');
  marker.setAttribute('markerWidth', '20');
  marker.setAttribute('markerHeight', '10');
  marker.setAttribute('orient', 'auto');
  marker.setAttributeNS(null, "fill", color);
  var path = document.createElementNS('http://www.w3.org/2000/svg',
    'path');
  marker.appendChild(path);
  path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  defs.appendChild(marker);
}


//
// encodings for outgoing video
//

// just two resolutions, for now, as chrome 75 seems to ignore more
// than two encodings
//
const CAM_VIDEO_SIMULCAST_ENCODINGS =
[
  { maxBitrate:  96000, scaleResolutionDownBy: 4 },
  { maxBitrate: 680000, scaleResolutionDownBy: 1 },
];

function camEncodings() {
  return CAM_VIDEO_SIMULCAST_ENCODINGS;
}

//
// our "signaling" function -- just an http fetch
//

async function sig(endpoint, data, beacon) {
  try {
    let headers = { 'Content-Type': 'application/json' },
        body = JSON.stringify({ ...data, peerId: myPeerId });

    if (beacon) {
      navigator.sendBeacon('/signaling/' + endpoint, body);
      return null;
    }

    let response = await fetch(
      '/signaling/' + endpoint, { method: 'POST', body, headers }
    );
    return await response.json();
  } catch (e) {
    console.error(e);
    return { error: e };
  }
}

//
// simple uuid helper function
//

function uuidv4() {
  return ('111-111-1111').replace(/[018]/g, () =>
         (crypto.getRandomValues(new Uint8Array(1))[0] & 15).toString(16));
}

//
// promisified sleep
//

async function sleep(ms) {
  return new Promise((r) => setTimeout(() => r(), ms));
}
