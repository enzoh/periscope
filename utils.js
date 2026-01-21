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

const workingCameras = Array.from({length:26}, (_, i) => i + 1);
const MAX_RETRY_ATTEMPTS = 3; // 3 retries for real cameras (network hiccups are common)
const RETRY_DELAY_BASE = 2000; // 2 seconds base delay for network recovery

function setLiveFeedSources(){
    for(let cam of workingCameras){
        let port = 8001;
        if([13, 11, 12, 9].includes(cam)) port = 8000;
        else if([10, 8, 7, 4].includes(cam)) port = 8001;
        else if([2, 3, 1, 5].includes(cam)) port = 8002;
        else if([6, 14, 15, 16].includes(cam)) port = 8003;
        else if([17, 18, 19, 20].includes(cam)) port = 8004;
        else if([21, 22, 23, 24, 25, 26].includes(cam)) port = 8005;
        cameraSources.set(cam, `http://127.0.0.1:${port}/video${cam}`);
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
    const src = cameraSources.get(camNum);
    if (!src) return false;
    
    // MJPEG streams (multipart/x-mixed-replace) should use <img>, not <video>
    // Check if it's a video file extension (actual video codecs)
    return src.match(/\.(mp4|webm|ogg|mov)$/i) !== null;
}

function ensureElementType(element,camNum){
    const isVideo=isVideoSource(camNum);
    const currentTag=element.tagName.toLowerCase();
    const originalClassName=element.className||'';
    const originalEventType=element.dataset.eventType||'';
    const originalCamera=element.dataset.camera||'';
    
    if(isVideo&&currentTag!=='video'){
        const video=document.createElement('video');
        video.autoplay=true;
        video.muted=true;
        video.loop=true;
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
                // Reset retry count and failure status on successful load
                cameraRetryCounts.delete(camNum);
                cameraFailureStatus.delete(camNum);
                hideCameraError(camNum);
                resolve(element);
            };
        }else{
            element=new Image();
            element.onload=()=>{
                loadingByCamera.delete(cacheKey);
                loadedElements.set(camNum,element);
                // Reset retry count and failure status on successful load
                cameraRetryCounts.delete(camNum);
                cameraFailureStatus.delete(camNum);
                hideCameraError(camNum);
                resolve(element);
            };
        }
        
        element.onerror=(e)=>{
            if(e) e.preventDefault();
            loadingByCamera.delete(cacheKey);
            
            // Track retry count
            const retryCount = cameraRetryCounts.get(camNum) || 0;
            cameraRetryCounts.set(camNum, retryCount + 1);
            
            // If too many failures, mark as failed
            if(retryCount + 1 >= MAX_RETRY_ATTEMPTS) {
                cameraFailureStatus.set(camNum, true);
                showCameraError(camNum);
            }
            
            reject(new Error(`Failed to load ${src}`));
        };
        
        element.src=src;
        if(isVideo){
            element.load();
            element.play().catch(err=>{
                console.error(`Camera ${camNum} video playback failed:`, err);
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
            const retryCount = cameraRetryCounts.get(camNum) || 0;
            cameraRetryCounts.set(camNum, retryCount + 1);
            
            if(retryCount + 1 >= MAX_RETRY_ATTEMPTS) {
                cameraFailureStatus.set(camNum, true);
                showCameraError(element);
            } else {
                // Retry after timeout
                const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
                setTimeout(() => {
                    if(element.parentNode && element.dataset.camera == camNum.toString()) {
                        if(!cameraFailureStatus.get(camNum)) {
                            const retrySrc = getCameraSource(camNum, true);
                            element.src = retrySrc;
                        }
                    }
                }, delay);
            }
        }
    }, 8000);
    
    element.onerror=(e)=>{
        if(e) e.preventDefault();
        if(loadTimeout) clearTimeout(loadTimeout);
        
        // Don't double-count if timeout already fired
        if(timeoutFired) return true;
        
        // Track retry count
        const retryCount = cameraRetryCounts.get(camNum) || 0;
        const newRetryCount = retryCount + 1;
        cameraRetryCounts.set(camNum, newRetryCount);
        
        // If too many failures, mark as failed and show error
        if(newRetryCount >= MAX_RETRY_ATTEMPTS) {
            cameraFailureStatus.set(camNum, true);
            showCameraError(element);
        } else {
            // Retry with exponential backoff
            const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
            setTimeout(() => {
                // Only retry if element still exists and is still assigned to this camera
                if(element.parentNode && element.dataset.camera == camNum.toString()) {
                    if(cameraFailureStatus.get(camNum)) {
                        // Already marked as failed, don't retry
                        return;
                    }
                    // Retry with cache busting
                    const retrySrc = getCameraSource(camNum, true);
                    if(element.tagName.toLowerCase() === 'video') {
                        element.src = retrySrc;
                        element.load();
                        element.play().catch(() => {});
                    } else {
                        element.src = retrySrc;
                    }
                }
            }, delay);
        }
        
        return true;
    };
    
    // Clear timeout and reset retry count when image loads successfully
    if(element.tagName.toLowerCase() !== 'video') {
        const originalOnload = element.onload;
        element.onload = (e) => {
            if(loadTimeout) clearTimeout(loadTimeout);
            // Reset retry count and failure status on successful load
            cameraRetryCounts.delete(camNum);
            cameraFailureStatus.delete(camNum);
            hideCameraError(camNum);
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
                const retryCount = cameraRetryCounts.get(camNum) || 0;
                cameraRetryCounts.set(camNum, retryCount + 1);
                
                if(retryCount + 1 >= MAX_RETRY_ATTEMPTS) {
                    cameraFailureStatus.set(camNum, true);
                    showCameraError(element);
                } else {
                    // Retry after timeout
                    const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
                    setTimeout(() => {
                        if(element.parentNode && element.dataset.camera == camNum.toString()) {
                            if(!cameraFailureStatus.get(camNum)) {
                                const retrySrc = getCameraSource(camNum, true);
                                element.src = retrySrc;
                                element.load();
                                element.play().catch(() => {});
                            }
                        }
                    }, delay);
                }
            }
        }, 8000);
        
        // Set up error handler for video
        const videoErrorHandler = (e) => {
            if(e) e.preventDefault();
            if(videoLoadTimeout) clearTimeout(videoLoadTimeout);
            
            // Don't double-count if timeout already fired
            if(videoTimeoutFired) return true;
            
            // Track retry count
            const retryCount = cameraRetryCounts.get(camNum) || 0;
            const newRetryCount = retryCount + 1;
            cameraRetryCounts.set(camNum, newRetryCount);
            
            // If too many failures, mark as failed and show error
            if(newRetryCount >= MAX_RETRY_ATTEMPTS) {
                cameraFailureStatus.set(camNum, true);
                showCameraError(element);
            } else {
                // Retry with exponential backoff
                const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
                setTimeout(() => {
                    // Only retry if element still exists and is still assigned to this camera
                    if(element.parentNode && element.dataset.camera == camNum.toString()) {
                        if(cameraFailureStatus.get(camNum)) {
                            // Already marked as failed, don't retry
                            return;
                        }
                        // Retry with cache busting
                        const retrySrc = getCameraSource(camNum, true);
                        element.src = retrySrc;
                        element.load();
                        element.play().catch(() => {});
                    }
                }, delay);
            }
        };
        
        // Clear timeout and reset retry count when video can play
        element.oncanplay = () => {
            if(videoLoadTimeout) clearTimeout(videoLoadTimeout);
            // Reset retry count and failure status on successful load
            cameraRetryCounts.delete(camNum);
            cameraFailureStatus.delete(camNum);
            hideCameraError(camNum);
        };
        
        element.onerror = videoErrorHandler;
        element.src=targetSrc;
        element.load();
        element.play().catch(err=>{
            console.error(`Camera ${camNum} video playback failed:`, err);
            // Treat play failure as an error too - but only if video actually fails to load
            // Don't count play() promise rejections as errors if the video is actually loading
            // The onerror handler will catch actual loading errors
        });
    }else{
        element.onload=null;
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
