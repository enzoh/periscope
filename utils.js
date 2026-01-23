const originalError = console.error;
const originalWarn = console.warn;

console.error = function(...args) {
    const msg = args.join(' ');
    if (msg.includes('502') || msg.includes('Bad Gateway') || msg.includes('/video')) {
        return;
    }
    originalError.apply(console, args);
};

console.warn = function(...args) {
    const msg = args.join(' ');
    if (msg.includes('502') || msg.includes('Bad Gateway') || msg.includes('/video')) {
        return;
    }
    originalWarn.apply(console, args);
};

window.addEventListener('error', function(e) {
    if (e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO')) {
        e.preventDefault();
        e.stopPropagation();
        return true;
    }
}, true);

const cameraSources=new Map();
const loadingByCamera=new Map();
const loadedElements=new Map();
const cameraRetryCounts=new Map();
const cameraFailureStatus=new Map(); // tracks if camera has failed many times

// Fallback system: MPEG-TS → MJPEG → Offline
const cameraStreamType=new Map(); // 'mpegts' or 'mjpeg' for each camera
const cameraRetryState=new Map(); // {attempts: 0, lastAttempt: timestamp, currentDelay: 1000}

const workingCameras = Array.from({length:26}, (_, i) => i + 1);
const MAX_RETRY_DELAY = 64000; // Cap at 64 seconds
const INITIAL_RETRY_DELAY = 1000; // Start at 1 second

// ============================================================================
// STREAMING FALLBACK SYSTEM
// ============================================================================
// All cameras try MPEG-TS first → fallback to MJPEG → show offline
// Exponential backoff retry: 1s, 2s, 4s, 8s, 16s, 32s, 64s (cap)
// ============================================================================

function getMJPEGSource(cam) {
        let port = 8001;
        if([13, 11, 12, 9].includes(cam)) port = 8000;
        else if([10, 8, 7, 4].includes(cam)) port = 8001;
        else if([2, 3, 1, 5].includes(cam)) port = 8002;
        else if([6, 14, 15, 16].includes(cam)) port = 8003;
        else if([17, 18, 19, 20].includes(cam)) port = 8004;
        else if([21, 22, 23, 24, 25, 26].includes(cam)) port = 8005;
    return `http://127.0.0.1:${port}/video${cam}`;
}

function setLiveFeedSources(){
    for(let cam of workingCameras){
        // Initialize all cameras to try MPEG-TS first
        if(!cameraStreamType.has(cam)){
            cameraStreamType.set(cam, 'mpegts');
        }
        
        // Set source based on current stream type
        const streamType = cameraStreamType.get(cam);
        if(streamType === 'mpegts'){
            cameraSources.set(cam, `${window.location.origin}/mpegts/${cam}`);
        } else {
            cameraSources.set(cam, getMJPEGSource(cam));
        }
    }
}

function getCameraSource(camNum,useCacheBust=false){
    const base=cameraSources.get(camNum);
    
    if(!base){
        return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }
    
    const isVideoStream = base.startsWith('http://127.0.0.1:') && base.includes('/video');
    if(useCacheBust && !isVideoStream){
        return base+'?t='+Date.now();
    }
    return base;
}

function isVideoSource(camNum){
    // Check if this camera currently uses MPEG-TS (requires <video> tag)
    const streamType = cameraStreamType.get(camNum);
    return streamType === 'mpegts';
}

function fallbackToMJPEG(camNum){
    console.log(`Camera ${camNum}: Falling back to MJPEG`);
    cameraStreamType.set(camNum, 'mjpeg');
    cameraSources.set(camNum, getMJPEGSource(camNum));
    
    // Reset retry state for MJPEG attempt
    cameraRetryState.delete(camNum);
}

function scheduleRetry(camNum, callback){
    // Get or initialize retry state
    let state = cameraRetryState.get(camNum);
    if(!state){
        state = {
            attempts: 0,
            currentDelay: INITIAL_RETRY_DELAY,
            lastAttempt: 0
        };
        cameraRetryState.set(camNum, state);
    }
    
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 64s (cap at 64s)
    const delay = Math.min(state.currentDelay, MAX_RETRY_DELAY);
    
    console.log(`Camera ${camNum}: Retry in ${delay/1000}s (attempt ${state.attempts + 1})`);
    
    setTimeout(() => {
        state.attempts++;
        state.lastAttempt = Date.now();
        state.currentDelay = Math.min(state.currentDelay * 2, MAX_RETRY_DELAY);
        cameraRetryState.set(camNum, state);
        
        callback();
    }, delay);
}

function resetRetryState(camNum){
    // Reset retry state on successful connection
    cameraRetryState.delete(camNum);
    cameraRetryCounts.delete(camNum);
    cameraFailureStatus.delete(camNum);
}

function ensureElementType(element,camNum){
    const isVideo=isVideoSource(camNum);
    const currentTag=element.tagName.toLowerCase();
    const originalClassName=element.className||'';
    const originalEventType=element.dataset.eventType||'';
    const originalCamera=element.dataset.camera||'';
    
    if(isVideo&&currentTag!=='video'){
        // Need to switch from img to video
        const video=document.createElement('video');
        video.autoplay=true;
        video.muted=true;
        video.playsInline=true;
        Array.from(element.attributes).forEach(attr=>{
            if(attr.name!=='src'){
                video.setAttribute(attr.name,attr.value);
            }
        });
        if(originalCamera)video.dataset.camera=originalCamera;
        if(originalEventType)video.dataset.eventType=originalEventType;
        if(originalClassName)video.className=originalClassName;
        video.style.cssText=element.style.cssText;
        if(element.parentNode){
            element.parentNode.replaceChild(video,element);
        }
        return video;
    }else if(!isVideo&&currentTag!=='img'){
        // Need to switch from video to img - clean up mpegts.js player first
        if(element.mpegtsPlayer){
            element.mpegtsPlayer.destroy();
            element.mpegtsPlayer = null;
        }
        
        const img=document.createElement('img');
        Array.from(element.attributes).forEach(attr=>{
            if(attr.name!=='src'){
                img.setAttribute(attr.name,attr.value);
            }
        });
        if(originalCamera)img.dataset.camera=originalCamera;
        if(originalEventType)img.dataset.eventType=originalEventType;
        if(originalClassName)img.className=originalClassName;
        img.style.cssText=element.style.cssText;
        if(element.parentNode){
            element.parentNode.replaceChild(img,element);
        }
        return img;
    }
    return element;
}

function preloadCamera(camNum,useCacheBust=false){
    const cacheKey=camNum+(useCacheBust?'_retry':'');
    if(loadingByCamera.has(cacheKey)){
        return loadingByCamera.get(cacheKey);
    }
    
    const src=getCameraSource(camNum,useCacheBust);
    const isVideo=isVideoSource(camNum);
    
    const promise=new Promise((resolve,reject)=>{
        let element;
        if(isVideo){
            element=document.createElement('video');
            element.autoplay=true;
            element.muted=true;
            element.loop=true;
            element.playsInline=true;
            element.oncanplay=()=>{
                loadingByCamera.delete(cacheKey);
                loadedElements.set(camNum,element);
                // Reset all retry state on successful load
                resetRetryState(camNum);
                hideCameraError(camNum);
                resolve(element);
            };
        }else{
            element=new Image();
            element.onload=()=>{
                loadingByCamera.delete(cacheKey);
                loadedElements.set(camNum,element);
                // Reset all retry state on successful load
                resetRetryState(camNum);
                hideCameraError(camNum);
                resolve(element);
            };
        }
        
        element.onerror=(e)=>{
            if(e) e.preventDefault();
            loadingByCamera.delete(cacheKey);
            
            // Preload uses fallback logic - just reject and let setImageSource handle it
            const currentStreamType = cameraStreamType.get(camNum);
            console.warn(`Camera ${camNum}: Preload failed (${currentStreamType.toUpperCase()})`);
            
            reject(new Error(`Failed to load ${src}`));
        };
        
        element.src=src;
        if(isVideo){
            element.load();
            element.play().catch(err=>{
                // Suppress AbortError as it's expected during rapid source changes
                if(err.name !== 'AbortError') {
                console.error(`Camera ${camNum} video playback failed:`, err);
                }
            });
        }
        loadingByCamera.set(cacheKey,promise);
    });
    
    return promise;
}

function setImageSource(element,camNum){
    if(!element.dataset.camera){
        element.dataset.camera=camNum;
    }
    
    const originalClassName=element.className||'';
    const originalEventType=element.dataset.eventType||'';
    
    element=ensureElementType(element,camNum);
    
    if(!element.dataset.camera){
        element.dataset.camera=camNum;
    }
    
    if(originalClassName){
        element.className=originalClassName;
    }
    if(originalEventType){
        element.dataset.eventType=originalEventType;
    }
    
    // If camera is already marked as failed, show error but still try to load
    // This allows recovery if the camera comes back online
    if(cameraFailureStatus.get(camNum)) {
        // Small delay to ensure element is in DOM and wrapper is set up
        setTimeout(() => {
            if(element.parentNode && element.dataset.camera == camNum.toString()) {
                showCameraError(element);
            }
        }, 100);
        // Still attempt to load - cameras can recover
        // Reset retry count to give it a fresh chance
        cameraRetryCounts.delete(camNum);
    }
    
    const targetSrc=getCameraSource(camNum);
    
    if(element.src===targetSrc)return element;
    
    const baseCacheKey=camNum;
    const retryCacheKey=camNum+'_retry';
    if(loadingByCamera.has(baseCacheKey)||loadingByCamera.has(retryCacheKey)){
        (loadingByCamera.get(baseCacheKey)||loadingByCamera.get(retryCacheKey)).then(()=>{
            if(element.parentNode&&element.dataset.camera==camNum.toString()){
                setImageSource(element,camNum);
            }
        }).catch(()=>{});
        return element;
    }
    
    // Add a timeout to detect if image never loads (stuck loading)
    let loadTimeout = null;
    let timeoutFired = false;
    loadTimeout = setTimeout(() => {
        // If image hasn't loaded or errored after 8 seconds, consider it failed
        if(!element.complete && !cameraFailureStatus.get(camNum)) {
            timeoutFired = true;
            console.warn(`Camera ${camNum}: Load timeout (8s)`);
            
            const currentStreamType = cameraStreamType.get(camNum);
            if(currentStreamType === 'mpegts'){
                // MPEG-TS timed out, fallback to MJPEG
                console.log(`Camera ${camNum}: MPEG-TS timeout, falling back to MJPEG`);
                fallbackToMJPEG(camNum);
                setImageSource(element, camNum);
            } else {
                // MJPEG also timed out, show error and schedule retry
                console.error(`Camera ${camNum}: MJPEG timeout, showing offline`);
                cameraFailureStatus.set(camNum, true);
                showCameraError(element);
                
                scheduleRetry(camNum, () => {
                    console.log(`Camera ${camNum}: Retrying MPEG-TS...`);
                    cameraStreamType.set(camNum, 'mpegts');
                    cameraSources.set(camNum, `${window.location.origin}/mpegts/${camNum}`);
                    cameraFailureStatus.delete(camNum);
                    
                    const retryElement = document.querySelector(`[data-camera="${camNum}"]`);
                    if(retryElement){
                        hideCameraError(camNum);
                        setImageSource(retryElement, camNum);
                    }
                });
            }
        }
    }, 8000);
    
    element.onerror=(e)=>{
        if(e) e.preventDefault();
        if(loadTimeout) clearTimeout(loadTimeout);
        
        // Don't double-count if timeout already fired
        if(timeoutFired) return true;
        
        const currentStreamType = cameraStreamType.get(camNum);
        
        // FALLBACK LOGIC (for non-video elements - images)
        if(currentStreamType === 'mpegts'){
            // MPEG-TS failed, fallback to MJPEG
            console.log(`Camera ${camNum}: MPEG-TS error, falling back to MJPEG`);
            fallbackToMJPEG(camNum);
            setImageSource(element, camNum);
        } else {
            // MJPEG also failed, show error and schedule retry
            console.error(`Camera ${camNum}: MJPEG error, showing offline`);
            cameraFailureStatus.set(camNum, true);
            showCameraError(element);
            
            scheduleRetry(camNum, () => {
                console.log(`Camera ${camNum}: Retrying MPEG-TS...`);
                cameraStreamType.set(camNum, 'mpegts');
                cameraSources.set(camNum, `${window.location.origin}/mpegts/${camNum}`);
                cameraFailureStatus.delete(camNum);
                
                const retryElement = document.querySelector(`[data-camera="${camNum}"]`);
                if(retryElement){
                    hideCameraError(camNum);
                    setImageSource(retryElement, camNum);
                }
            });
        }
        
        return true;
    };
    
    // Clear timeout and reset retry state when image loads successfully
    if(element.tagName.toLowerCase() !== 'video') {
        const originalOnload = element.onload;
        element.onload = (e) => {
            if(loadTimeout) clearTimeout(loadTimeout);
            // Reset all retry state on successful load
            resetRetryState(camNum);
            hideCameraError(camNum);
            
            const streamType = cameraStreamType.get(camNum);
            console.log(`Camera ${camNum}: ${streamType.toUpperCase()} stream connected successfully`);
            
            if(originalOnload) originalOnload.call(element, e);
        };
    }
    
    if(element.tagName.toLowerCase()==='video'){
        element.oncanplay=null;
        element.onerror=null; // Remove previous error handler temporarily
        
        // Add timeout for video - if it doesn't load after 8 seconds, consider it failed
        let videoLoadTimeout = null;
        let videoTimeoutFired = false;
        videoLoadTimeout = setTimeout(() => {
            if(element.readyState < 2 && !cameraFailureStatus.get(camNum)) {
                videoTimeoutFired = true;
                console.warn(`Camera ${camNum}: Video load timeout (8s)`);
                videoErrorHandler(); // Use fallback logic on timeout
            }
        }, 8000);
        
        // Set up error handler for video with fallback logic
        const videoErrorHandler = (e) => {
            if(e) e.preventDefault();
            if(videoLoadTimeout) clearTimeout(videoLoadTimeout);
            
            // Don't double-count if timeout already fired
            if(videoTimeoutFired) return true;
            
            const currentStreamType = cameraStreamType.get(camNum);
            
            // FALLBACK LOGIC:
            // 1. MPEG-TS fails → try MJPEG
            // 2. MJPEG fails → show offline + exponential backoff retry
            
            if(currentStreamType === 'mpegts'){
                // MPEG-TS failed, fallback to MJPEG
                console.log(`Camera ${camNum}: MPEG-TS failed, falling back to MJPEG`);
                fallbackToMJPEG(camNum);
                
                // Reload with MJPEG
                const mjpegSrc = getCameraSource(camNum);
                element = ensureElementType(element, camNum); // Switch to <img> if needed
                element.dataset.camera = camNum;
                setImageSource(element, camNum); // Retry with MJPEG
                
            } else {
                // MJPEG also failed, show error and schedule exponential backoff retry
                console.error(`Camera ${camNum}: MJPEG failed, showing offline`);
                cameraFailureStatus.set(camNum, true);
                showCameraError(element);
                
                // Schedule retry with exponential backoff
                scheduleRetry(camNum, () => {
                    console.log(`Camera ${camNum}: Retrying MPEG-TS...`);
                    // Reset to try MPEG-TS again
                    cameraStreamType.set(camNum, 'mpegts');
                    cameraSources.set(camNum, `${window.location.origin}/mpegts/${camNum}`);
                    cameraFailureStatus.delete(camNum);
                    
                    // Find the element and reload
                    const retryElement = document.querySelector(`[data-camera="${camNum}"]`);
                    if(retryElement){
                        hideCameraError(camNum);
                        setImageSource(retryElement, camNum);
                    }
                });
            }
        };
        
        // Clear timeout and reset retry state when video can play
        element.oncanplay = () => {
            if(videoLoadTimeout) clearTimeout(videoLoadTimeout);
            // Reset all retry state on successful load
            resetRetryState(camNum);
            hideCameraError(camNum);
            
            const streamType = cameraStreamType.get(camNum);
            console.log(`Camera ${camNum}: ${streamType.toUpperCase()} stream connected successfully`);
        };
        
        element.onerror = videoErrorHandler;
        
        // Check if this camera currently uses MPEG-TS
        const currentStreamType = cameraStreamType.get(camNum);
        if(currentStreamType === 'mpegts' && typeof mpegts !== 'undefined'){
            // Clean up existing mpegts.js player if any
            if(element.mpegtsPlayer){
                element.mpegtsPlayer.destroy();
                element.mpegtsPlayer = null;
            }
            
            // Use mpegts.js for MPEG-TS streams (same config as test_mpegts.html)
            if(mpegts.getFeatureList().mseLivePlayback){
                const player = mpegts.createPlayer({
                    type: 'mpegts',
                    isLive: true,
                    url: targetSrc
                }, {
                    // ABSOLUTE MINIMUM LATENCY CONFIG (from test_mpegts.html)
                    enableWorker: true,
                    enableStashBuffer: false,
                    stashInitialSize: 4,
                    
                    // Aggressive latency chasing
                    liveBufferLatencyChasing: true,
                    liveBufferLatencyMaxLatency: 0.8,
                    liveBufferLatencyMinRemain: 0.1,
                    liveSyncDurationCount: 1,
                    
                    // Immediate loading
                    lazyLoad: false,
                    lazyLoadMaxDuration: 0,
                    lazyLoadRecoverDuration: 0,
                    deferLoadAfterSourceOpen: false,
                    
                    // Aggressive cleanup
                    autoCleanupSourceBuffer: true,
                    autoCleanupMaxBackwardDuration: 1,
                    autoCleanupMinBackwardDuration: 0.5,
                    
                    // Reduce chunking
                    fixAudioTimestampGap: false
                });
                
                player.attachMediaElement(element);
                
                // Track if we've received any data
                let hasReceivedData = false;
                player.on(mpegts.Events.MEDIA_INFO, function() {
                    hasReceivedData = true;
                });
                
                player.on(mpegts.Events.ERROR, function(errorType, errorDetail, errorInfo) {
                    console.error(`Camera ${camNum} MPEG-TS error:`, errorType, errorDetail);
                    
                    // Trigger fallback on any fatal error
                    if(errorType === mpegts.ErrorTypes.NETWORK_ERROR || 
                       errorType === mpegts.ErrorTypes.MEDIA_ERROR ||
                       !hasReceivedData){
                        videoErrorHandler();
                    }
                });
                
                player.load();
                player.play().catch(err=>{
                    if(err.name !== 'AbortError') {
                        console.error(`Camera ${camNum} MPEG-TS playback failed:`, err);
                        videoErrorHandler(); // Trigger fallback on playback error
                    }
                });
                
                element.mpegtsPlayer = player;
            } else {
                console.error(`Camera ${camNum}: MSE not supported for MPEG-TS`);
                // Fallback to MJPEG if MSE not supported
                videoErrorHandler();
            }
        } else {
            // Regular video or image source (MJPEG)
        element.src=targetSrc;
        element.load();
        element.play().catch(err=>{
                // AbortError is expected when video sources change rapidly
                if(err.name !== 'AbortError') {
            console.error(`Camera ${camNum} video playback failed:`, err);
                    videoErrorHandler(); // Trigger fallback on playback error
                }
        });
        }
    }else{
        // MJPEG image handling
        element.onload = () => {
            // Reset retry state on successful MJPEG load
            resetRetryState(camNum);
            hideCameraError(camNum);
            console.log(`Camera ${camNum}: MJPEG stream connected successfully`);
        };
        
        element.onerror = () => {
            console.error(`Camera ${camNum}: MJPEG load failed`);
            cameraFailureStatus.set(camNum, true);
            showCameraError(element);
            
            // Schedule retry with exponential backoff
            scheduleRetry(camNum, () => {
                console.log(`Camera ${camNum}: Retrying MPEG-TS...`);
                // Reset to try MPEG-TS again
                cameraStreamType.set(camNum, 'mpegts');
                cameraSources.set(camNum, `${window.location.origin}/mpegts/${camNum}`);
                cameraFailureStatus.delete(camNum);
                
                // Find the element and reload
                const retryElement = document.querySelector(`[data-camera="${camNum}"]`);
                if(retryElement){
                    hideCameraError(camNum);
                    setImageSource(retryElement, camNum);
                }
            });
        };
        
        element.src=targetSrc;
    }
    
    preloadCamera(camNum).then(()=>{
        loadedElements.set(camNum,element);
    }).catch(()=>{});
    
    return element;
}

function preloadImage(camNum){
    return preloadCamera(camNum);
}

function showCameraError(camNumOrElement) {
    // Find all elements for this camera
    const camNum = typeof camNumOrElement === 'number' ? camNumOrElement : parseInt(camNumOrElement?.dataset?.camera);
    if(!camNum || isNaN(camNum)) return;
    
    // Note: We now allow error overlays on active cameras too
    
    // Note: We don't check getRecentShown() here because:
    // 1. When called from error handler, camera might not be assigned yet
    // 2. The restoration logic in updateDisplay() handles showing errors only for displayed cameras
    // So we try to show the error, and if the camera isn't displayed, it won't be visible anyway
    
    // Find the wrapper that contains this camera's img element
    let container = null;
    
    // If an element was passed, try to find its parent wrapper first
    if(typeof camNumOrElement !== 'number' && camNumOrElement) {
        const element = camNumOrElement;
        // If it's already a wrapper div, use it
        if(element.tagName === 'DIV' && element.parentElement === document.body) {
            // Check if it contains the right camera
            const img = element.querySelector('img, video');
            if(img && parseInt(img.dataset.camera) === camNum) {
                container = element;
            }
        } else {
            // If it's an img/video, walk up the tree to find the wrapper
            let parent = element.parentElement;
            while(parent && parent !== document.body) {
                if(parent.tagName === 'DIV' && parent.parentElement === document.body) {
                    // Found a direct child div of body - this is likely our wrapper
                    // Verify it contains our element
                    if(parent.contains(element) && parseInt(element.dataset.camera) === camNum) {
                        container = parent;
                        break;
                    }
                }
                parent = parent.parentElement;
            }
        }
    }
    
    // If not found, search by camera number
    if(!container) {
        // First, try to find active camera wrappers (event-wrapper)
        if(typeof activeWrappers !== 'undefined' && Array.isArray(activeWrappers)) {
            for(const wrapper of activeWrappers) {
                if(!wrapper || wrapper.tagName !== 'DIV') continue;
                
                const img = wrapper.querySelector('img, video');
                if(img) {
                    const imgCamNum = parseInt(img.dataset.camera);
                    if(imgCamNum === camNum) {
                        container = wrapper;
                        break;
                    }
                }
            }
        }
        
        // Then try backgroundElements array
        if(!container && typeof backgroundElements !== 'undefined' && Array.isArray(backgroundElements)) {
            for(const wrapper of backgroundElements) {
                if(!wrapper || wrapper.tagName !== 'DIV') continue;
                
                const img = wrapper.querySelector('img, video');
                if(img) {
                    const imgCamNum = parseInt(img.dataset.camera);
                    if(imgCamNum === camNum) {
                        container = wrapper;
                        break;
                    }
                }
            }
        }
        
        // If not found, search through all body > div elements
        if(!container) {
            Array.from(document.body.children).forEach(child => {
                if(child.tagName !== 'DIV') return;
            
                // Check if this wrapper contains an img/video with matching camera number
                const img = child.querySelector('img, video');
                if(img) {
                    const imgCamNum = parseInt(img.dataset.camera);
                    if(imgCamNum === camNum) {
                        container = child;
                        return;
                    }
                }
            });
        }
    }
    
    if(!container) {
        // Still not found - this shouldn't happen but return gracefully
        // But try one more time: if an element was passed, just find any wrapper
        // and we'll use it (the restoration logic will handle proper positioning)
        if(typeof camNumOrElement !== 'number' && camNumOrElement && camNumOrElement.parentElement) {
            let parent = camNumOrElement.parentElement;
            while(parent && parent !== document.body) {
                if(parent.tagName === 'DIV' && parent.parentElement === document.body && !parent.classList.contains('event-wrapper')) {
                    container = parent;
                    // Ensure the img inside has the right camera number
                    const img = container.querySelector('img, video');
                    if(img) {
                        img.dataset.camera = camNum.toString();
                    }
                    break;
                }
                parent = parent.parentElement;
            }
        }
        
        if(!container) {
            return;
        }
    }
    
    // Ensure container is a div with position relative
    if(container.tagName !== 'DIV') {
        // This shouldn't happen with the new structure, but handle it
        return;
    }
    
    // Ensure the img/video inside has the correct camera number set
    const img = container.querySelector('img, video');
    if(img && (!img.dataset.camera || parseInt(img.dataset.camera) !== camNum)) {
        img.dataset.camera = camNum.toString();
    }
    
    // Ensure container has position relative
    const containerStyle = window.getComputedStyle(container);
    if(containerStyle.position === 'static' || !containerStyle.position) {
        container.style.position = 'relative';
    }
    
    // Ensure container width and height are set (for proper overlay positioning)
    if(!container.style.width) {
        container.style.width = '100%';
    }
    if(!container.style.height) {
        container.style.height = '100%';
    }
    
    // Remove ALL existing error overlays first to avoid duplicates
    const existingOverlays = container.querySelectorAll('.camera-error-overlay');
    existingOverlays.forEach(overlay => overlay.remove());
    
    // Create new error overlay (only one)
    const errorOverlay = document.createElement('div');
            errorOverlay.className = 'camera-error-overlay';
            errorOverlay.innerHTML = `
                <div class="camera-error-content">
                    <div class="camera-error-title">CAMERA ${camNum} OFFLINE</div>
                    <div class="camera-error-subtitle">No signal available</div>
                </div>
            `;
            container.appendChild(errorOverlay);
        errorOverlay.style.display = 'flex';
}

function hideCameraError(camNumOrElement) {
    const camNum = typeof camNumOrElement === 'number' ? camNumOrElement : parseInt(camNumOrElement?.dataset?.camera);
    if(!camNum || isNaN(camNum)) return;
    
    // Find all error overlays for this camera and remove them
    document.querySelectorAll('.camera-error-overlay').forEach(overlay => {
        const camNumText = overlay.querySelector('.camera-error-title')?.textContent?.match(/CAMERA (\d+)/);
        if(camNumText && parseInt(camNumText[1]) === camNum) {
            overlay.remove();
        }
    });
    
    // Also find all wrappers containing this camera and remove error overlays
    // Check backgroundElements first
    if(typeof backgroundElements !== 'undefined' && Array.isArray(backgroundElements)) {
        backgroundElements.forEach(wrapper => {
            const img = wrapper.querySelector(`img[data-camera="${camNum}"]`);
            if(img) {
                const overlays = wrapper.querySelectorAll('.camera-error-overlay');
                overlays.forEach(overlay => overlay.remove());
            }
        });
    }
    
    // Also check active wrappers
    if(typeof activeWrappers !== 'undefined' && Array.isArray(activeWrappers)) {
        activeWrappers.forEach(wrapper => {
            const img = wrapper.querySelector(`img[data-camera="${camNum}"]`);
            if(img) {
                const overlays = wrapper.querySelectorAll('.camera-error-overlay');
                overlays.forEach(overlay => overlay.remove());
        }
    });
    }
}
