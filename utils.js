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

const workingCameras = Array.from({length:26}, (_, i) => i + 1);

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
                resolve(element);
            };
        }else{
            element=new Image();
            element.onload=()=>{
                loadingByCamera.delete(cacheKey);
                loadedElements.set(camNum,element);
                resolve(element);
            };
        }
        
        element.onerror=(e)=>{
            if(e) e.preventDefault();
            loadingByCamera.delete(cacheKey);
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
    
    element.onerror=(e)=>{
        if(e) e.preventDefault();
        return true;
    };
    
    if(element.tagName.toLowerCase()==='video'){
        element.oncanplay=null;
        element.src=targetSrc;
        element.load();
        element.play().catch(err=>{
            console.error(`Camera ${camNum} video playback failed:`, err);
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
