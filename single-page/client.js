
import * as config from './config';
import * as mediasoup from 'mediasoup-client';
import deepEqual from 'deep-equal';
import debugModule from 'debug';

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
           moderatorPeerID = '';

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

  // if (GazeData.state !== 0) {
  //   if (gaze.style.display === 'block')
  //     gaze.style.display = 'none';
  // } else {
  //   if (gaze.style.display === 'none')
  //     gaze.style.display = 'block';
  // }

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

  GazeCloudAPI.OnCalibrationComplete = function () {
    console.log('gaze Calibration Complete');
  }
  GazeCloudAPI.OnCamDenied = function () { console.log('camera access denied') }
  GazeCloudAPI.OnError = function (msg) { console.log('err: ' + msg) }
  GazeCloudAPI.UseClickRecalibration = true;
  GazeCloudAPI.OnResult = processGaze
}

//
// meeting control actions
//

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

export async function startScreenshare() {
  log('start screen share');
  $('#share-screen').style.display = 'none';

  // make sure we've joined the room and that we have a sending
  // transport
  await joinRoom();
  if (!sendTransport) {
    sendTransport = await createTransport('send');
  }

  // get a screen share track
  localScreen = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true
  });

  // create a producer for video
  screenVideoProducer = await sendTransport.produce({
    track: localScreen.getVideoTracks()[0],
    encodings: screenshareEncodings(),
    appData: { mediaTag: 'screen-video' }
  });

  // create a producer for audio, if we have it
  if (localScreen.getAudioTracks().length) {
    screenAudioProducer = await sendTransport.produce({
      track: localScreen.getAudioTracks()[0],
      appData: { mediaTag: 'screen-audio' }
    });
  }

  // handler for screen share stopped event (triggered by the
  // browser's built-in screen sharing ui)
  screenVideoProducer.track.onended = async () => {
    log('screen share stopped');
    try {
      await screenVideoProducer.pause();
      let { error } = await sig('close-producer',
                                { producerId: screenVideoProducer.id });
      await screenVideoProducer.close();
      screenVideoProducer = null;
      if (error) {
        err(error);
      }
      if (screenAudioProducer) {
        let { error } = await sig('close-producer',
                                  { producerId: screenAudioProducer.id });
        await screenAudioProducer.close();
        screenAudioProducer = null;
        if (error) {
          err(error);
        }
      }
    } catch (e) {
      console.error(e);
    }
    $('#local-screen-pause-ctrl').style.display = 'none';
    $('#local-screen-audio-pause-ctrl').style.display = 'none';
    $('#share-screen').style.display = 'initial';
  }

  $('#local-screen-pause-ctrl').style.display = 'block';
  if (screenAudioProducer) {
    $('#local-screen-audio-pause-ctrl').style.display = 'block';
  }
}

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

// switch to sending video from the "next" camera device in our device
// list (if we have multiple cameras)
export async function cycleCamera() {
  if (!(camVideoProducer && camVideoProducer.track)) {
    warn('cannot cycle camera - no current camera track');
    return;
  }

  log ('cycle camera');

  // find "next" device in device list
  let deviceId = await getCurrentDeviceId(),
      allDevices = await navigator.mediaDevices.enumerateDevices(),
      vidDevices = allDevices.filter((d) => d.kind === 'videoinput');
  if (!vidDevices.length > 1) {
    warn('cannot cycle camera - only one camera');
    return;
  }
  let idx = vidDevices.findIndex((d) => d.deviceId === deviceId);
  if (idx === (vidDevices.length-1)) {
    idx = 0;
  } else {
    idx += 1;
  }

  // get a new video stream. might as well get a new audio stream too,
  // just in case browsers want to group audio/video streams together
  // from the same device when possible (though they don't seem to,
  // currently)
  log('getting a video stream from new device', vidDevices[idx].label);
  localCam = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: vidDevices[idx].deviceId } },
    audio: true
  });

  // replace the tracks we are sending
  await camVideoProducer.replaceTrack({ track: localCam.getVideoTracks()[0] });
  await camAudioProducer.replaceTrack({ track: localCam.getAudioTracks()[0] });

  // update the user interface
  // showCameraInfo();
}

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

  $('#viz1').checked = false;
  changePeekaboo();
  $('#viz2').checked = false;
  changeSpotlight();
  $('#viz3').checked = false;
  changeSpy();

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

export async function unsubscribeFromTrack(peerId, mediaTag) {
  let consumer = findConsumerForTrack(peerId, mediaTag);
  if (!consumer) {
    return;
  }

  log('unsubscribe from track', peerId, mediaTag);
  try {
    await closeConsumer(consumer);
  } catch (e) {
    console.error(e);
  }
  // force update of ui
  // updatePeersDisplay();
}

export async function pauseConsumer(consumer) {
  if (consumer) {
    log('pause consumer', consumer.appData.peerId, consumer.appData.mediaTag);
    try {
      await sig('pause-consumer', { consumerId: consumer.id });
      await consumer.pause();
    } catch (e) {
      console.error(e);
    }
  }
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

export async function pauseProducer(producer) {
  if (producer) {
    log('pause producer', producer.appData.mediaTag);
    try {
      await sig('pause-producer', { producerId: producer.id });
      await producer.pause();
    } catch (e) {
      console.error(e);
    }
  }
}

export async function resumeProducer(producer) {
  if (producer) {
    log('resume producer', producer.appData.mediaTag);
    try {
      await sig('resume-producer', { producerId: producer.id });
      await producer.resume();
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
    $('#moderator_status').innerHTML = 'Moderater ' + currentNameMap['participant_' + moderatorPeerID];
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

export function getCamPausedState() {
  return !$('#local-cam-checkbox').checked;
}

export function getMicPausedState() {
  return !$('#local-mic-checkbox').checked;
}

export function getScreenPausedState() {
  return !$('#local-screen-checkbox').checked;
}

export function getScreenAudioPausedState() {
  return !$('#local-screen-audio-checkbox').checked;
}

export async function changeCamPaused() {
  if (getCamPausedState()) {
    pauseProducer(camVideoProducer);
    $('#local-cam-label').innerHTML = 'camera (paused)';
  } else {
    resumeProducer(camVideoProducer);
    $('#local-cam-label').innerHTML = 'camera';
  }
}

export async function changeMicPaused() {
  if (getMicPausedState()) {
    pauseProducer(camAudioProducer);
    $('#local-mic-label').innerHTML = 'mic (paused)';
  } else {
    resumeProducer(camAudioProducer);
    $('#local-mic-label').innerHTML = 'mic';
  }
}

export async function changeScreenPaused() {
  if (getScreenPausedState()) {
    pauseProducer(screenVideoProducer);
    $('#local-screen-label').innerHTML = 'screen (paused)';
  } else {
    resumeProducer(screenVideoProducer);
    $('#local-screen-label').innerHTML = 'screen';
  }
}

export async function changeScreenAudioPaused() {
  if (getScreenAudioPausedState()) {
    pauseProducer(screenAudioProducer);
    $('#local-screen-audio-label').innerHTML = 'screen (paused)';
  } else {
    resumeProducer(screenAudioProducer);
    $('#local-screen-audio-label').innerHTML = 'screen';
  }
}

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

function makeTrackControlEl(peerName, mediaTag, mediaInfo) {
  let div = document.createElement('div'),
      peerId = (peerName === 'my' ? myPeerId : peerName),
      consumer = findConsumerForTrack(peerId, mediaTag);
  div.classList = `track-subscribe track-subscribe-${peerId}`;

  if (peerName !== 'my') {
    let sub = document.createElement('button');
    if (!consumer) {
      sub.innerHTML += 'subscribe'
      sub.onclick = () => subscribeToTrack(peerId, mediaTag);
      div.appendChild(sub);

    } else {
      sub.innerHTML += 'unsubscribe'
      sub.onclick = () => unsubscribeFromTrack(peerId, mediaTag);
      div.appendChild(sub);
    }
  }
  

  let trackDescription = document.createElement('span');
  trackDescription.innerHTML = `${peerName} ${mediaTag}`
  div.appendChild(trackDescription);

  // 9/14 don't need those
  // try {
  //   if (mediaInfo) {
  //     let producerPaused = mediaInfo.paused;
  //     let prodPauseInfo = document.createElement('span');
  //     prodPauseInfo.innerHTML = producerPaused ? '[producer paused]'
  //                                              : '[producer playing]';
  //     div.appendChild(prodPauseInfo);
  //   }
  // } catch (e) {
  //   console.error(e);
  // }

  // if (consumer) {
  //   let pause = document.createElement('span'),
  //       checkbox = document.createElement('input'),
  //       label = document.createElement('label');
  //   pause.classList = 'nowrap';
  //   checkbox.type = 'checkbox';
  //   checkbox.checked = !consumer.paused;
  //   checkbox.onchange = async () => {
  //     if (checkbox.checked) {
  //       await resumeConsumer(consumer);
  //     } else {
  //       await pauseConsumer(consumer);
  //     }
  //     updatePeersDisplay();
  //   }
  //   label.id = `consumer-stats-${consumer.id}`;
  //   if (consumer.paused) {
  //     label.innerHTML = '[consumer paused]'
  //   } else {
  //     let stats = lastPollSyncData[myPeerId].stats[consumer.id],
  //         bitrate = '-';
  //     if (stats) {
  //       bitrate = Math.floor(stats.bitrate / 1000.0);
  //     }
  //     label.innerHTML = `[consumer playing ${bitrate} kb/s]`;
  //   }
  //   pause.appendChild(checkbox);
  //   pause.appendChild(label);
  //   div.appendChild(pause);

  //   if (consumer.kind === 'video') {
  //     let remoteProducerInfo = document.createElement('span');
  //     remoteProducerInfo.classList = 'nowrap track-ctrl';
  //     remoteProducerInfo.id = `track-ctrl-${consumer.producerId}`;
  //     div.appendChild(remoteProducerInfo);
  //   }
  // }

  return div;
}

function addMyVideoAudio() {
  if (isModerator) {
    return;
  }
  let div = document.createElement('div');
  div.setAttribute('class', 'participant_div');
  div.setAttribute('id', 'participant_' + myPeerId + '_div');
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
    el.setAttribute('playsinline', true);
    el.setAttribute('autoplay', true);
    $(`#remote-${consumer.kind}`).appendChild(el);
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

async function showCameraInfo() {
  let deviceId = await getCurrentDeviceId(),
      infoEl = $('#camera-info');
  if (!deviceId) {
    infoEl.innerHTML = '';
    return;
  }
  let devices = await navigator.mediaDevices.enumerateDevices(),
      deviceInfo = devices.find((d) => d.deviceId === deviceId);
  infoEl.innerHTML = `
      ${ deviceInfo.label }
      <button onclick="Client.cycleCamera()">switch camera</button>
  `;
}

export async function getCurrentDeviceId() {
  if (!camVideoProducer) {
    return null;
  }
  let deviceId = camVideoProducer.track.getSettings().deviceId;
  if (deviceId) {
    return deviceId;
  }
  // Firefox doesn't have deviceId in MediaTrackSettings object
  let track = localCam && localCam.getVideoTracks()[0];
  if (!track) {
    return null;
  }
  let devices = await navigator.mediaDevices.enumerateDevices(),
      deviceInfo = devices.find((d) => d.label.startsWith(track.label));
  return deviceInfo.deviceId;
}

function updateActiveSpeaker() {

  $$('.participant_div').forEach((el) => {
    el.classList.remove('speaker');
  })
  $('#moderator_status').innerHTML = 'Moderator: ' + currentNameMap['participant_' + moderatorPeerID];

  if (currentActiveSpeaker.peerId) {
    if (currentActiveSpeaker.peerId === moderatorPeerID) {
      // display speaker status
      $('#moderator_status').innerHTML = 'Moderator ' + currentNameMap['participant_' + moderatorPeerID] + ' is speaking'
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
  return {target, gazeMap};
}

export async function changePeekaboo() {
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
  // remove all viz if ckecked -> unchecked
  if (!$('#viz2').checked) {
    justUnchecked = true;
  }
}

function updateSpotlight(distributionMap) {
  for (var key in distributionMap) {
    if ($('#' + key) !== null) {
      $('#' + key).style.opacity = 0.3 + distributionMap[key] * 0.7;
    }
  }
}

export async function changeSpy() {
  // remove all viz if ckecked -> unchecked
  if (!$('#viz3').checked) {
    if ($('#svg-canvas') !== null) {
      $('#svg-canvas').remove();
    }
  }
}

function updateSpy(target, gazeMap_, distributionMap) {
  if ($('#svg-canvas') !== null) {
    $('#svg-canvas').innerHTML = '';
    markerInitialized = false;
  }
  if (target in gazeMap_) {
    const gaze = gazeMap_[target];
    if ((gaze in distributionMap) && (gaze !== target)) {
      connectDivs($(`#${target}_div`), $(`#${gaze}_div`), '#00FF7F', 4);
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

  if (y1 === y2) {
    // same line
    x1 += (elem1.offsetWidth / 2);
    y1 += elem1.offsetHeight;
    x2 += (elem2.offsetWidth / 2);
    y2 += elem2.offsetHeight;

  } else if (y1 < y2) {
    // 1 is top, 2 is btm
    x1 += (elem1.offsetWidth / 2);
    y1 += elem1.offsetHeight;
    x2 += (elem2.offsetWidth / 2);
  } else {
    // 1 is btm, 2 is top
    x1 += (elem1.offsetWidth / 2);
    x2 += (elem2.offsetWidth / 2);
    y2 += elem2.offsetHeight;
  }

  // var width = x2 - x1;
  // var height = y2 - y1;

  drawCircle(x1, y1, 5, color);
  // drawCircle(x2, y2, 3, color);
  createTriangleMarker(color);
  drawCurvedLine(x1, y1, x2, y2, color, tension);
}

function drawCurvedLine(x1, y1, x2, y2, color, tension) {
  var svg = createSVG();
  var shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  var gap = 10;
  if (y2 === y1) {
    y2 += gap;
    var delta = 20 * tension;
    var hx1 = x1;
    var hy1 = y1 + delta;
    var hx2 = x2;
    var hy2 = y2 + delta;
    var path = "M " + x1 + " " + y1 +
      " C " + hx1 + " " + hy1 + " "
      + hx2 + " " + hy2 + " "
      + x2 + " " + y2;
  } else if (x1 < x2) {
    if (y1 > y2) {
      y2 += gap;
    } else {
      y2 -= gap;
    }
    var delta = 20 * tension;
    var hx1 = x1;
    var hy1 = y1 - delta;
    var hx2 = x2;
    var hy2 = y2 + delta;
    var path = "M " + x1 + " " + y1 +
      " C " + hx1 + " " + hy1 + " "
      + hx2 + " " + hy2 + " "
      + x2 + " " + y2;
  } else {
    if (y1 > y2) {
      y2 += gap;
    } else {
      y2 -= gap;
    }
    var delta = 20 * tension;
    if (x1 === x2) {
      var delta = 0;
    }
    var hx1 = x1;
    var hy1 = y1 + delta;
    var hx2 = x2;
    var hy2 = y2 - delta;
    var path = "M " + x1 + " " + y1 +
      " C " + hx1 + " " + hy1 + " "
      + hx2 + " " + hy2 + " "
      + x2 + " " + y2;
  }
  shape.setAttributeNS(null, "d", path);
  shape.setAttributeNS(null, "fill", "none");
  shape.setAttributeNS(null, "stroke", color);
  shape.setAttributeNS(null, "stroke-width", 3);
  shape.setAttributeNS(null, "stroke-linecap", 'round');
  shape.setAttributeNS(null, "marker-end", "url(#triangle)");
  svg.appendChild(shape);
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
  marker.setAttribute('markerWidth', '10');
  marker.setAttribute('markerHeight', '5');
  marker.setAttribute('orient', 'auto');
  marker.setAttributeNS(null, "fill", color);
  var path = document.createElementNS('http://www.w3.org/2000/svg',
    'path');
  marker.appendChild(path);
  path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  defs.appendChild(marker);
}

function updateCamVideoProducerStatsDisplay() {
  let tracksEl = $('#camera-producer-stats');
  tracksEl.innerHTML = '';
  if (!camVideoProducer || camVideoProducer.paused) {
    return;
  }
  // makeProducerTrackSelector({
  //   internalTag: 'local-cam-tracks',
  //   container: tracksEl,
  //   peerId: myPeerId,
  //   producerId: camVideoProducer.id,
  //   currentLayer: camVideoProducer.maxSpatialLayer,
  //   layerSwitchFunc: (i) => {
  //     console.log('client set layers for cam stream');
  //     camVideoProducer.setMaxSpatialLayer(i) }
  // });
}

function updateScreenVideoProducerStatsDisplay() {
  let tracksEl = $('#screen-producer-stats');
  tracksEl.innerHTML = '';
  if (!screenVideoProducer || screenVideoProducer.paused) {
    return;
  }
  makeProducerTrackSelector({
    internalTag: 'local-screen-tracks',
    container: tracksEl,
    peerId: myPeerId,
    producerId: screenVideoProducer.id,
    currentLayer: screenVideoProducer.maxSpatialLayer,
    layerSwitchFunc: (i) => {
      console.log('client set layers for screen stream');
      screenVideoProducer.setMaxSpatialLayer(i) }
  });
}

function updateConsumersStatsDisplay() {
  try {
    for (let consumer of consumers) {
      let label = $(`#consumer-stats-${consumer.id}`);
      if (label) {
        if (consumer.paused) {
          label.innerHTML = '(consumer paused)'
        } else {
          let stats = lastPollSyncData[myPeerId].stats[consumer.id],
              bitrate = '-';
          if (stats) {
            bitrate = Math.floor(stats.bitrate / 1000.0);
          }
          label.innerHTML = `[consumer playing ${bitrate} kb/s]`;
        }
      }

      let mediaInfo = lastPollSyncData[consumer.appData.peerId] &&
                      lastPollSyncData[consumer.appData.peerId]
                        .media[consumer.appData.mediaTag];
      if (mediaInfo && !mediaInfo.paused) {
        let tracksEl = $(`#track-ctrl-${consumer.producerId}`);
        if (tracksEl && lastPollSyncData[myPeerId]
                               .consumerLayers[consumer.id]) {
          tracksEl.innerHTML = '';
          let currentLayer = lastPollSyncData[myPeerId]
                               .consumerLayers[consumer.id].currentLayer;
          makeProducerTrackSelector({
            internalTag: consumer.id,
            container: tracksEl,
            peerId: consumer.appData.peerId,
            producerId: consumer.producerId,
            currentLayer: currentLayer,
            layerSwitchFunc: (i) => {
              console.log('ask server to set layers');
              sig('consumer-set-layers', { consumerId: consumer.id,
                                           spatialLayer: i });
            }
          });
        }
      }
    }
  } catch (e) {
    log('error while updating consumers stats display', e);
  }
}

function makeProducerTrackSelector({ internalTag, container, peerId, producerId,
                                     currentLayer, layerSwitchFunc }) {
  try {
    let pollStats = lastPollSyncData[peerId] &&
                    lastPollSyncData[peerId].stats[producerId];
    if (!pollStats) {
      return;
    }

    let stats = [...Array.from(pollStats)]
                  .sort((a,b) => a.rid > b.rid ? 1 : (a.rid<b.rid ? -1 : 0));
    let i=0;
    for (let s of stats) {
      let div = document.createElement('div'),
          radio = document.createElement('input'),
          label = document.createElement('label'),
          x = i;
      radio.type = 'radio';
      radio.name = `radio-${internalTag}-${producerId}`;
      radio.checked = currentLayer == undefined ?
                          (i === stats.length-1) :
                          (i === currentLayer);
      radio.onchange = () => layerSwitchFunc(x);
      let bitrate = Math.floor(s.bitrate / 1000);
      label.innerHTML = `${bitrate} kb/s`;
      div.appendChild(radio);
      div.appendChild(label);
      container.appendChild(div);
      i++;
    }
    if (i) {
      let txt = document.createElement('div');
      txt.innerHTML = 'tracks';
      container.insertBefore(txt, container.firstChild);
    }
  } catch (e) {
    log('error while updating track stats display', e);
  }
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

// how do we limit bandwidth for screen share streams?
//
function screenshareEncodings() {
  null;
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
