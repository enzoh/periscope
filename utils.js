const cameraSources=new Map();
const loadingByCamera=new Map();
const loadedElements=new Map();
const retryTimeouts=new Map();

// This function sets live video feed URLs for all 26 cameras based on periscope/index.html (lines 33-161)
// To use live feeds instead of static images, call this function (e.g., setLiveFeedSources())
// and replace getCameraSource() calls or modify getCameraSource() to use cameraSources.get(camNum)
function setLiveFeedSources(){
    // Port 8000: cameras 13, 11, 12, 9
    cameraSources.set(13,'http://127.0.0.1:8000/video13');
    cameraSources.set(11,'http://127.0.0.1:8000/video11');
    cameraSources.set(12,'http://127.0.0.1:8000/video12');
    cameraSources.set(9,'http://127.0.0.1:8000/video9');
    
    // Port 8001: cameras 10, 8, 7, 4
    cameraSources.set(10,'http://127.0.0.1:8001/video10');
    cameraSources.set(8,'http://127.0.0.1:8001/video8');
    cameraSources.set(7,'http://127.0.0.1:8001/video7');
    cameraSources.set(4,'http://127.0.0.1:8001/video4');
    
    // Port 8002: cameras 2, 3, 1, 5
    cameraSources.set(2,'http://127.0.0.1:8002/video2');
    cameraSources.set(3,'http://127.0.0.1:8002/video3');
    cameraSources.set(1,'http://127.0.0.1:8002/video1');
    cameraSources.set(5,'http://127.0.0.1:8002/video5');
    
    // Port 8003: cameras 6, 14, 15, 16
    cameraSources.set(6,'http://127.0.0.1:8003/video6');
    cameraSources.set(14,'http://127.0.0.1:8003/video14');
    cameraSources.set(15,'http://127.0.0.1:8003/video15');
    cameraSources.set(16,'http://127.0.0.1:8003/video16');
    
    // Port 8004: cameras 17, 18, 19, 20
    cameraSources.set(17,'http://127.0.0.1:8004/video17');
    cameraSources.set(18,'http://127.0.0.1:8004/video18');
    cameraSources.set(19,'http://127.0.0.1:8004/video19');
    cameraSources.set(20,'http://127.0.0.1:8004/video20');
    
    // Port 8005: cameras 21, 22, 23, 24, 25, 26
    cameraSources.set(21,'http://127.0.0.1:8005/video21');
    cameraSources.set(22,'http://127.0.0.1:8005/video22');
    cameraSources.set(23,'http://127.0.0.1:8005/video23');
    cameraSources.set(24,'http://127.0.0.1:8005/video24');
    cameraSources.set(25,'http://127.0.0.1:8005/video25');
    cameraSources.set(26,'http://127.0.0.1:8005/video26');
}

function getCameraSource(camNum,useCacheBust=false){
    const base=cameraSources.get(camNum)||`Images/${camNum}.png`;
    if(useCacheBust){
        return base+'?t='+Date.now();
    }
    return base;
}

function isVideoSource(camNum){
    return cameraSources.has(camNum);
}

function ensureElementType(element,camNum){
    const isVideo=isVideoSource(camNum);
    const currentTag=element.tagName.toLowerCase();
    
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
        if(element.dataset.camera)video.dataset.camera=element.dataset.camera;
        if(element.dataset.eventType)video.dataset.eventType=element.dataset.eventType;
        video.className=element.className;
        video.style.cssText=element.style.cssText;
        element.parentNode.replaceChild(video,element);
        return video;
    }else if(!isVideo&&currentTag!=='img'){
        const img=document.createElement('img');
        Array.from(element.attributes).forEach(attr=>{
            if(attr.name!=='src'){
                img.setAttribute(attr.name,attr.value);
            }
        });
        if(element.dataset.camera)img.dataset.camera=element.dataset.camera;
        if(element.dataset.eventType)img.dataset.eventType=element.dataset.eventType;
        img.className=element.className;
        img.style.cssText=element.style.cssText;
        element.parentNode.replaceChild(img,element);
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
        
        element.onerror=()=>{
            loadingByCamera.delete(cacheKey);
            reject(new Error(`Failed to load ${src}`));
        };
        
        element.src=src;
        loadingByCamera.set(cacheKey,promise);
    });
    
    return promise;
}

function setImageSource(element,camNum){
    if(!element.dataset.camera){
        element.dataset.camera=camNum;
    }
    
    element=ensureElementType(element,camNum);
    const targetSrc=getCameraSource(camNum);
    
    if(element.src===targetSrc)return;
    
    const baseCacheKey=camNum;
    const retryCacheKey=camNum+'_retry';
    if(loadingByCamera.has(baseCacheKey)||loadingByCamera.has(retryCacheKey)){
        (loadingByCamera.get(baseCacheKey)||loadingByCamera.get(retryCacheKey)).then(()=>{
            if(element.parentNode&&element.dataset.camera==camNum.toString()){
                setImageSource(element,camNum);
            }
        }).catch(()=>{});
        return;
    }
    
    element.onerror=()=>{
        handleError(element,camNum);
    };
    
    if(element.tagName.toLowerCase()==='video'){
        element.oncanplay=null;
        element.src=targetSrc;
        element.load();
    }else{
        element.onload=null;
        element.src=targetSrc;
    }
    
    preloadCamera(camNum).then(()=>{
        loadedElements.set(camNum,element);
    }).catch(()=>{
        handleError(element,camNum);
    });
}

function handleError(element,camNum,retryCount=0){
    const currentCamNum=element.dataset.camera?parseInt(element.dataset.camera):camNum;
    if(retryCount>=3)return;
    
    if(retryTimeouts.has(currentCamNum)){
        clearTimeout(retryTimeouts.get(currentCamNum));
    }
    
    const timeoutId=setTimeout(()=>{
        retryTimeouts.delete(currentCamNum);
        if(!element.parentNode||element.dataset.camera!=currentCamNum.toString())return;
        
        loadedElements.delete(currentCamNum);
        
        preloadCamera(currentCamNum,true).then(()=>{
            if(element.parentNode&&element.dataset.camera==currentCamNum.toString()){
                setImageSource(element,currentCamNum);
            }
        }).catch(()=>{
            handleError(element,currentCamNum,retryCount+1);
        });
    },1000*(retryCount+1));
    
    retryTimeouts.set(currentCamNum,timeoutId);
}

function preloadImage(camNum){
    return preloadCamera(camNum);
}
