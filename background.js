// Muaz Khan     - https://github.com/muaz-khan
// MIT License   - https://www.WebRTC-Experiment.com/licence/
// Source Code   - https://github.com/muaz-khan/Chrome-Extensions

// this page is using desktopCapture API to capture and record screen
// http://developer.chrome.com/extensions/desktopCapture.html

chrome.browserAction.setIcon({
    path: 'images/main-icon.png'
});

chrome.commands.onCommand.addListener(function(command) {
  console.log('Command:', command);
    if (command == "start_screencast") {
        captureDesktop();
    }
    if (command == "start_screenshot") {
        screenshot_current_tab();
    }
});

var screenshot = {
  content : document.createElement("canvas"),
  data : '',
  saveScreenshot : function() {
    var image = new Image();
    image.onload = function() {
      var canvas = screenshot.content;
      canvas.width = image.width;
      canvas.height = image.height;
      var context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);

      // save the image
      var link = document.createElement('a');
      link.download = "screenshot.png";
      link.href = screenshot.content.toDataURL();
      link.click();
      screenshot.data = '';
    };
    image.src = screenshot.data;
  }
};

function screenshot_current_tab() {
    chrome.tabs.captureVisibleTab(null, {quality: screenshot.QUALITY}, function(data) {
            screenshot.data = data;
            screenshot.saveScreenshot();
        }
    );
}

chrome.browserAction.onClicked.addListener(getUserConfigs);

function captureDesktop() {
    if (isRecordingVOD) {
        stopVODRecording();
        return;
    }

    if (recorder && recorder.stream && recorder.stream.onended) {
        recorder.stream.onended();
        return;
    }

    chrome.browserAction.setIcon({
        path: 'images/main-icon.png'
    });

    var screenSources = ['window', 'screen'];

    if (enableTabAudio) {
        screenSources = ['tab', 'audio'];
    }

    try {
        chrome.desktopCapture.chooseDesktopMedia(screenSources, onAccessApproved);
    } catch (e) {
        getUserMediaError();
    }
}

var recorder;

function onAccessApproved(chromeMediaSourceId) {
    if (!chromeMediaSourceId || !chromeMediaSourceId.toString().length) {
        if (getChromeVersion() < 53) {
            getUserMediaError();
            return;
        }

        askToStopExternalStreams();
        setDefaults();
        chrome.runtime.reload();
        return;
    }

    var constraints = {
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: chromeMediaSourceId
            },
            optional: []
        }
    };

    if (aspectRatio) {
        constraints.video.mandatory.minAspectRatio = aspectRatio;
    }

    if (videoMaxFrameRates && videoMaxFrameRates.toString().length) {
        videoMaxFrameRates = parseInt(videoMaxFrameRates);

        // 30 fps seems max-limit in Chrome?
        if (videoMaxFrameRates /* && videoMaxFrameRates <= 30 */ ) {
            constraints.video.maxFrameRate = videoMaxFrameRates;
        }
    }

    if (resolutions.maxWidth && resolutions.maxHeight) {
        constraints.video.mandatory.maxWidth = resolutions.maxWidth;
        constraints.video.mandatory.maxHeight = resolutions.maxHeight;
    }

    if (enableTabAudio) {
        constraints.audio = {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: chromeMediaSourceId
            },
            optional: []
        };
    }

    navigator.webkitGetUserMedia(constraints, gotStream, getUserMediaError);

    function gotStream(stream) {
        var options = {
            type: 'video',
            disableLogs: false,
            recorderType: MediaStreamRecorder // StereoAudioRecorder
        };

        if (videoCodec && videoCodec !== 'Default') {
            // chrome 49+= supports vp8+vp9 (30 fps) and opus 48khz
            // firefox 30+ VP8 + vorbis 44.1 khz

            // video/webm,codecs=vp9
            options.mimeType = 'video/webm; codecs=' + videoCodec.toLowerCase();
        }

        if (getChromeVersion() >= 52) {
            if (audioBitsPerSecond) {
                audioBitsPerSecond = parseInt(audioBitsPerSecond);
                if (!audioBitsPerSecond || audioBitsPerSecond > 128) { // 128000
                    audioBitsPerSecond = 128;
                }
                if (!audioBitsPerSecond || audioBitsPerSecond < 6) {
                    audioBitsPerSecond = 6; // opus (smallest 6kbps, maximum 128kbps)
                }
            }

            if (videoBitsPerSecond) {
                videoBitsPerSecond = parseInt(videoBitsPerSecond);
                if (!videoBitsPerSecond || videoBitsPerSecond < 100) {
                    videoBitsPerSecond = 100; // vp8 (smallest 100kbps)
                }
            }

            if (enableTabAudio || enableMicrophone) {
                if (audioBitsPerSecond) {
                    options.audioBitsPerSecond = audioBitsPerSecond * 1000;
                }
                if (videoBitsPerSecond) {
                    options.videoBitsPerSecond = videoBitsPerSecond * 1000;
                }
            } else if (videoBitsPerSecond) {
                options.bitsPerSecond = videoBitsPerSecond * 1000;
            }
        }

        if (audioStream && audioStream.getAudioTracks && audioStream.getAudioTracks().length) {
            audioPlayer = document.createElement('audio');
            audioPlayer.src = URL.createObjectURL(audioStream);

            audioPlayer.play();

            context = new AudioContext();

            var gainNode = context.createGain();
            gainNode.connect(context.destination);
            gainNode.gain.value = 0; // don't play for self

            mediaStremSource = context.createMediaStreamSource(audioStream);
            mediaStremSource.connect(gainNode);

            mediaStremDestination = context.createMediaStreamDestination();
            mediaStremSource.connect(mediaStremDestination)

            stream.addTrack(mediaStremDestination.stream.getAudioTracks()[0]);
        }

        recorder = RecordRTC(stream, options);

        try {
            recorder.startRecording();
            alreadyHadGUMError = false;
        } catch (e) {
            getUserMediaError();
        }

        recorder.stream = stream;

        isRecording = true;
        onRecording();

        recorder.stream.onended = function() {
            if (recorder && recorder.stream) {
                recorder.stream.onended = function() {};
            }

            stopScreenRecording();
        };

        recorder.stream.getVideoTracks()[0].onended = function() {
            if (recorder && recorder.stream && recorder.stream.onended) {
                recorder.stream.onended();
            }
        };

        initialTime = Date.now()
        timer = setInterval(checkTime, 100);
    }
}

function askToStopExternalStreams() {
    try {
        runtimePort.postMessage({
            stopStream: true,
            messageFromContentScript1234: true
        });
    } catch (e) {}
}

var peer;

function stopScreenRecording() {
    isRecording = false;

    recorder.stopRecording(function() {
        invokeSaveAsDialog(recorder.blob, 'RecordRTC-' + (new Date).toISOString().replace(/:|\./g, '-') + '.webm');

        setTimeout(function() {
            setDefaults();
            chrome.runtime.reload();
        }, 1000);

        askToStopExternalStreams();

        try {
            peer.close();
            peer = null;
        } catch (e) {}

        try {
            audioPlayer.src = null;
            mediaStremDestination.disconnect();
            mediaStremSource.disconnect();
            context.disconnect();
            context = null;
        } catch (e) {}
    });

    if (timer) {
        clearTimeout(timer);
    }
    setBadgeText('');

    chrome.browserAction.setTitle({
        title: 'Record Screen'
    });
}

function setDefaults() {
    chrome.browserAction.setIcon({
        path: 'images/main-icon.png'
    });

    if (recorder && recorder.stream) {
        recorder.stream.stop();
        if (recorder && recorder.stream && recorder.stream.onended) {
            recorder.stream.onended();
        }
    }

    recorder = null;
    isRecording = false;
    imgIndex = 0;
}

var isRecording = false;
var images = ['recordRTC-progress-1.png', 'recordRTC-progress-2.png', 'recordRTC-progress-3.png', 'recordRTC-progress-4.png', 'recordRTC-progress-5.png'];
var imgIndex = 0;
var reverse = false;

function onRecording() {
    chrome.browserAction.setIcon({
        path: 'images/' + images[imgIndex]
    });

    if (!reverse) {
        imgIndex++;

        if (imgIndex > images.length - 1) {
            imgIndex = images.length - 1;
            reverse = true;
        }
    } else {
        imgIndex--;

        if (imgIndex < 0) {
            imgIndex = 1;
            reverse = false;
        }
    }

    if (isRecording) {
        setTimeout(onRecording, 800);
        return;
    }

    chrome.browserAction.setIcon({
        path: 'images/main-icon.png'
    });
}

function setBadgeText(text) {
    chrome.browserAction.setBadgeBackgroundColor({
        color: [255, 0, 0, 255]
    });

    chrome.browserAction.setBadgeText({
        text: text + ''
    });
}

var initialTime, timer;

function checkTime() {
    if (!initialTime) return;
    var timeDifference = Date.now() - initialTime;
    var formatted = convertTime(timeDifference);
    setBadgeText(formatted);

    chrome.browserAction.setTitle({
        title: 'Recording duration: ' + formatted
    });
}

function convertTime(miliseconds) {
    var totalSeconds = Math.floor(miliseconds / 1000);
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds - minutes * 60;

    minutes += '';
    seconds += '';

    if (minutes.length === 1) {
        // minutes = '0' + minutes;
    }

    if (seconds.length === 1) {
        seconds = '0' + seconds;
    }

    return minutes + ':' + seconds;
}

function getChromeVersion() {
    var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
    return raw ? parseInt(raw[2], 10) : 52;
}

var resolutions = {
    maxWidth: 29999,
    maxHeight: 8640
};
var aspectRatio = 1.77;
var audioBitsPerSecond = 0;
var videoBitsPerSecond = 0;

var enableTabAudio = false;
var enableMicrophone = false;
var audioStream = false;

var videoCodec = 'Default';
var videoMaxFrameRates = '';

function getUserConfigs() {
    chrome.storage.sync.get(null, function(items) {
        if (items['audioBitsPerSecond'] && items['audioBitsPerSecond'].toString().length) {
            audioBitsPerSecond = parseInt(items['audioBitsPerSecond']);
        }

        if (items['videoBitsPerSecond'] && items['videoBitsPerSecond'].toString().length) {
            videoBitsPerSecond = parseInt(items['videoBitsPerSecond']);
        }

        if (items['enableTabAudio']) {
            enableTabAudio = items['enableTabAudio'] == 'true';
        }

        if (items['enableMicrophone']) {
            enableMicrophone = items['enableMicrophone'] == 'true';
        }

        if (items['videoCodec']) {
            videoCodec = items['videoCodec'];
        }

        if (items['videoMaxFrameRates'] && items['videoMaxFrameRates'].toString().length) {
            videoMaxFrameRates = parseInt(items['videoMaxFrameRates']);
        }

        var _resolutions = items['resolutions'];
        if (!_resolutions || _resolutions == 'Default (29999x8640)') {
            resolutions = {
                maxWidth: 29999,
                maxHeight: 8640
            }

            chrome.storage.sync.set({
                resolutions: _resolutions
            }, function() {});
        }

        if (_resolutions === '4K UHD (3840x2160)') {
            //  16:9
            aspectRatio = 1.77;

            resolutions.maxWidth = 3840;
            resolutions.maxHeight = 2160;
        }

        if (_resolutions === 'WQXGA (2560x1600)') {
            //  16:10
            aspectRatio = 1.6;

            resolutions.maxWidth = 2560;
            resolutions.maxHeight = 1600;
        }

        if (_resolutions === 'WQHD (2560x1440)') {
            //  16:9
            aspectRatio = 1.77;

            resolutions.maxWidth = 2560;
            resolutions.maxHeight = 1440;
        }

        if (_resolutions === 'WUXGA (1920x1200)') {
            //  16:10
            aspectRatio = 1.6;

            resolutions.maxWidth = 1920;
            resolutions.maxHeight = 1200;
        }

        if (_resolutions === 'Full HD (1920x1080)') {
            //  16:9
            aspectRatio = 1.77;

            resolutions.maxWidth = 1920;
            resolutions.maxHeight = 1080;
        }

        if (_resolutions === 'WSXGA+ (1680x1050)') {
            //  16:10
            aspectRatio = 1.6;

            resolutions.maxWidth = 1680;
            resolutions.maxHeight = 1050;
        }

        if (_resolutions === 'UXGA (1600x1200)') {
            //  4:3
            aspectRatio = 1.3;

            resolutions.maxWidth = 1600;
            resolutions.maxHeight = 1200;
        }

        if (_resolutions === 'HD+ (1600x900)') {
            //  16:9
            aspectRatio = 1.77;

            resolutions.maxWidth = 1600;
            resolutions.maxHeight = 900;
        }

        if (_resolutions === 'WXGA+ (1440x900)') {
            //  16:10
            aspectRatio = 1.6;

            resolutions.maxWidth = 1440;
            resolutions.maxHeight = 900;
        }

        if (_resolutions === 'HD (1366x768)') {
            //  ~16:9
            aspectRatio = 1.77;

            resolutions.maxWidth = 1366;
            resolutions.maxHeight = 768;
        }

        if (_resolutions === 'HD (1360x768)') {
            //  ~16:9
            aspectRatio = 1.77;

            resolutions.maxWidth = 1360;
            resolutions.maxHeight = 768;
        }

        if (_resolutions === 'SXGA') {
            //  5:4
            aspectRatio = 1.25;

            resolutions.maxWidth = 1280;
            resolutions.maxHeight = 1024;
        }

        if (_resolutions === 'WXGA (1280x800)') {
            //  16:10
            aspectRatio = 1.6;

            resolutions.maxWidth = 1280;
            resolutions.maxHeight = 800;
        }

        if (_resolutions === 'WXGA (1280x768)') {
            //  5:3
            aspectRatio = 1.67;

            resolutions.maxWidth = 1280;
            resolutions.maxHeight = 768;
        }

        if (_resolutions === 'WXGA (1280x720)') {
            //  16:9
            aspectRatio = 1.77;

            resolutions.maxWidth = 1280;
            resolutions.maxHeight = 720;
        }

        if (_resolutions === 'XGA+ (1152x864)') {
            //  4:3
            aspectRatio = 1.3;

            resolutions.maxWidth = 1152;
            resolutions.maxHeight = 864;
        }

        if (_resolutions === 'XGA (1024x768)') {
            //  4:3
            aspectRatio = 1.3;

            resolutions.maxWidth = 1024;
            resolutions.maxHeight = 768;
        }

        if (_resolutions === 'WSVGA (1024x600)') {
            //  ~17:10
            aspectRatio = 1.7;

            resolutions.maxWidth = 1024;
            resolutions.maxHeight = 600;
        }

        if (_resolutions === 'SVGA (800x600)') {
            //  4:3
            aspectRatio = 1.3;

            resolutions.maxWidth = 800;
            resolutions.maxHeight = 600;
        }

        if (_resolutions === '720p (1280x720)') {
            //  16:9
            aspectRatio = 1.77;

            resolutions.maxWidth = 1280;
            resolutions.maxHeight = 720;
        }

        if (_resolutions === '360p (640x360)') {
            //  16:9
            aspectRatio = 1.77;

            resolutions.maxWidth = 640;
            resolutions.maxHeight = 360;
        }

        if (enableMicrophone) {
            chrome.tabs.create({
                url: 'https://rtcxp.com'
            }, function(tab) {
                askContentScriptToSendMicrophone(tab.id);
            });
            return;
        }

        captureDesktop();
    });
}

var alreadyHadGUMError = false;

function getUserMediaError() {
    if (!alreadyHadGUMError) {
        // retry with default values
        resolutions = {};
        aspectRatio = false;
        audioBitsPerSecond = false;
        videoBitsPerSecond = false;

        enableTabAudio = false;
        enableMicrophone = false;
        audioStream = false;

        // below line makes sure we retried merely once
        alreadyHadGUMError = true;

        videoMaxFrameRates = '';
        videoCodec = 'Default';

        captureDesktop();
        return;
    }

    askToStopExternalStreams();
    setDefaults();
    chrome.runtime.reload();
}

// Check whether new version is installed
chrome.runtime.onInstalled.addListener(function(details) {
    if (details.reason.search(/install/g) === -1) return;
    chrome.runtime.openOptionsPage();
});

// Check for updates
chrome.runtime.onUpdateAvailable.addListener(function(details) {
    // alert('RecordRTC chrome-extension has new updates. Please update the extension.');
});

function msToTime(s) {

    function addZ(n) {
        return (n < 10 ? '0' : '') + n;
    }

    var ms = s % 1000;
    s = (s - ms) / 1000;
    var secs = s % 60;
    s = (s - secs) / 60;
    var mins = s % 60;
    var hrs = (s - mins) / 60;

    return addZ(hrs) + ':' + addZ(mins) + ':' + addZ(secs) + '.' + ms;
}

function setVODRecordingBadgeText(text, title) {
    chrome.browserAction.setBadgeBackgroundColor({
        color: [203, 0, 15, 255]
    });

    chrome.browserAction.setBadgeText({
        text: text
    });

    chrome.browserAction.setTitle({
        title: title && title.length ? title + ' duration' : 'Record Screen'
    });
}

var runtimePort;

chrome.runtime.onConnect.addListener(function(port) {
    runtimePort = port;

    runtimePort.onMessage.addListener(function(message) {
        if (!message || !message.messageFromContentScript1234) {
            return;
        }

        // console.debug(JSON.stringify(message, null, '\t'));

        if (message.sdp) {
            createAnswer(message.sdp);
            return;
        }

        if (message.unableToRecordVideoFromSrc) {
            // alert('Unable to record this video.');
            return;
        }

        if (message.videoFromSrcRecordingStarted) {
            startedVODRecordedAt = (new Date).getTime();

            (function looper() {
                if (!isRecordingVOD) {
                    chrome.contextMenus.update(selectedMenuID, {
                        title: allMenus[selectedMenuID].title
                    });
                    setVODRecordingBadgeText('');
                    return;
                }

                var currentTime = (new Date).getTime();
                var text = msToTime(currentTime - startedVODRecordedAt);
                chrome.contextMenus.update(selectedMenuID, {
                    title: 'Stop recording this video (duration: ' + text + ')'
                });
                setVODRecordingBadgeText((currentTime - startedVODRecordedAt).toString(), text);

                setTimeout(looper, 1000);
            })();
            return;
        }

        if (message.videoFromSrcRecordingEnded) {
            chrome.contextMenus.update(selectedMenuID, {
                title: allMenus[selectedMenuID].title
            });
            return;
        }

        if (message.allVideoSrcs || message.allCanvasClasses) {
            onGettingMultipleVideosSrcs(message);
            return;
        }
    });

    if (pending.length) {
        pending.forEach(function(task) {
            runtimePort.postMessage(task);
        });
        pending = [];
    }

    runtimePort.postMessage({
        messageFromContentScript1234: true,
        giveMeAllSrcs: true
    });
});

var pending = [];

function askContentScriptToSendMicrophone(tabId) {
    chrome.tabs.update(tabId, {
        active: true
    }, function() {
        var message = {
            giveMeMicrophone: true,
            messageFromContentScript1234: true
        };

        try {
            runtimePort.postMessage(message);
        } catch (e) {
            pending.push(message);
        }
    });
}

function createAnswer(sdp) {
    peer = new webkitRTCPeerConnection(null);

    peer.onicecandidate = function(event) {
        if (!event || !!event.candidate) return;

        try {
            runtimePort.postMessage({
                sdp: peer.localDescription,
                messageFromContentScript1234: true
            });
        } catch (e) {}
    };

    peer.onaddstream = function(event) {
        audioStream = event.stream;
        captureDesktop();
    };

    peer.setRemoteDescription(new RTCSessionDescription(sdp));

    peer.createAnswer(function(sdp) {
        peer.setLocalDescription(sdp);
    }, function() {}, {
        optional: [],
        mandatory: {
            OfferToReceiveAudio: true,
            OfferToReceiveVideo: false
        }
    });
}

var audioPlayer, context, mediaStremSource, mediaStremDestination;

function getId(id) {
    return id.toString().replace(/-|\.|_|'|"|\/|\\|\?/g, '');
}

// context-menu
var contextMenuUID = getId('recordrtc-single-context-menu');
var allMenus = {};

function onGettingMultipleVideosSrcs(message) {
    var allVideoSrcs = message.allVideoSrcs;
    var allCanvasClasses = message.allCanvasClasses;

    Object.keys(allMenus).forEach(function(key) {
        chrome.contextMenus.remove(allMenus[key].id);
    });

    allMenus = {};

    allMenus[contextMenuUID] = {
        title: 'Record this video',
        id: contextMenuUID
    };

    try {
        chrome.contextMenus.create({
            title: allMenus[contextMenuUID].title,
            id: allMenus[contextMenuUID].id,
            type: 'normal',
            contexts: ['video']
        });
    }
    catch(e) {}

    allVideoSrcs.forEach(function(src) {
        var id = contextMenuUID + '____' + getId(src);
        if(allMenus[id]) return;
        allMenus[id] = {
            title: src,
            id: id,
            type: 'video'
        };

        try {
            chrome.contextMenus.create({
                title: allMenus[id].title + ' (video)',
                id: allMenus[id].id,
                type: 'normal',
                contexts: ['all']
            });
        }
        catch(e) {}
    });

    allCanvasClasses.forEach(function(className) {
        var id = contextMenuUID + '____' + getId(className);
        if(allMenus[id]) return;
        allMenus[id] = {
            title: className,
            id: id,
            type: 'canvas'
        };

        try {
            chrome.contextMenus.create({
                title: allMenus[id].title + ' (canvas)',
                id: allMenus[id].id,
                type: 'normal',
                contexts: ['all']
            });
        }
        catch(e) {}
    });
}

var isRecordingVOD = false;
var startedVODRecordedAt = (new Date).getTime();

var selectedMenuID = '';

chrome.contextMenus.onClicked.addListener(function(info, tab) {
    if (info.menuItemId.indexOf(contextMenuUID) !== -1) {
        if (!!isRecordingVOD) {
            stopVODRecording();
            return;
        }

        if (!info.srcUrl && allMenus[info.menuItemId]) {
            info.srcUrl = allMenus[info.menuItemId].title;
        }

        var url = info.srcUrl;
        if (!url || !url.length) return;

        isRecordingVOD = true;

        selectedMenuID = info.menuItemId;

        chrome.contextMenus.update(selectedMenuID, {
            title: 'Please wait..'
        });

        var type = 'video';
        if(allMenus[info.menuItemId] && allMenus[info.menuItemId].type) {
            type = allMenus[info.menuItemId].type;
        }

        try {
            runtimePort.postMessage({
                messageFromContentScript1234: true,
                recordThisSrc: url,
                recordType: type
            });
        } catch (e) {}
    }
});

function stopVODRecording() {
    chrome.contextMenus.update(selectedMenuID, {
        title: 'Please wait..'
    });

    try {
        runtimePort.postMessage({
            messageFromContentScript1234: true,
            stopRecordingThisSrc: true
        });
    } catch (e) {}

    isRecordingVOD = false;
}
