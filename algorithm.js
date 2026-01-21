const recent=[];
const active=[];
let previousReplacement=null;
const activeQueue=new Map();
const activeEventTypes=new Map();

let updateDisplayTimeout=null;

// Used to keep Recent_Shown stable when the number of active cameras changes.
// When the shown count shrinks (e.g., 12 -> 8), we rotate the *previously shown*
// list so previousReplacement becomes the first visible item, then take N.
let lastRecentShown=[];
let lastCountToShow=null;

function rotateToStart(arr,startValue){
    const idx=arr.indexOf(startValue);
    if(idx===-1)return arr.slice();
    return arr.slice(idx).concat(arr.slice(0,idx));
}

function getRecentShown(){
    const activeCount=active.length;
    let countToShow=16;
    if(activeCount===1)countToShow=12;
    else if(activeCount===2)countToShow=8;
    else if(activeCount===3)countToShow=4;
    else if(activeCount>=4)countToShow=0;
    
    // Filter out active cameras from recent
    const recentNonActive=recent.filter(c=>!active.includes(c));
    
    // If we don't have enough cameras, supplement with missing non-active cameras
    if(recentNonActive.length<countToShow){
        const allCameras=Array.from({length:26},(_,i)=>i+1);
        const nonActive=allCameras.filter(c=>!active.includes(c)&&!recent.includes(c));
        // Add missing cameras at the end (they're less recent)
        recentNonActive.push(...nonActive);
    }
    
    // If the visible count is shrinking, rotate the *previous* shown list so
    // previousReplacement stays visible (at the front) instead of being dropped.
    if(
        typeof lastCountToShow==='number' &&
        lastCountToShow>countToShow &&
        Array.isArray(lastRecentShown) &&
        lastRecentShown.length
    ){
        // Use the last shown list, but remove any that are now active.
        const lastNonActive=lastRecentShown.filter(c=>!active.includes(c));
        if(lastNonActive.length){
            const rotated=rotateToStart(lastNonActive,previousReplacement);
            const nextShown=rotated.slice(0,countToShow);
            lastCountToShow=countToShow;
            lastRecentShown=nextShown.slice();
            return nextShown;
        }
    }

    const nextShown=recentNonActive.slice(0,countToShow);
    lastCountToShow=countToShow;
    lastRecentShown=nextShown.slice();
    return nextShown;
}

function getActiveShown(){
    return active;
}

function onCameraActivate(camNum,eventType){
    const idx=recent.indexOf(camNum);
    if(idx!==-1)recent.splice(idx,1);
    
    if(!active.includes(camNum))active.push(camNum);
    
    activeEventTypes.set(camNum,eventType);
    
    if(activeQueue.has(camNum)){
        clearTimeout(activeQueue.get(camNum));
    }
    const timeoutId=setTimeout(()=>onCameraDeactivate(camNum),30000);
    activeQueue.set(camNum,timeoutId);
    
    // Ensure recent contains all non-active cameras (should be automatic, but double-check)
    const allCameras=Array.from({length:26},(_,i)=>i+1);
    const nonActive=allCameras.filter(c=>!active.includes(c));
    const missing=nonActive.filter(c=>!recent.includes(c));
    // Add missing cameras at the end (they're the least recent)
    recent.push(...missing);
    
    updateDisplay();
    console.log('Recent:',recent.slice(),'Recent_Shown:',getRecentShown(),'Active:',active.slice(),'Active_Shown:',getActiveShown(),'Previous_Replacement:',previousReplacement);
}

function onCameraDeactivate(camNum){
    const activeIdx=active.indexOf(camNum);
    if(activeIdx!==-1)active.splice(activeIdx,1);
    
    if(activeQueue.has(camNum)){
        clearTimeout(activeQueue.get(camNum));
        activeQueue.delete(camNum);
    }
    
    activeEventTypes.delete(camNum);
    
    const recentIdx=recent.indexOf(camNum);
    if(recentIdx!==-1)recent.splice(recentIdx,1);
    
    const recentShown=getRecentShown();
    
    if(previousReplacement===null){
        recent.unshift(camNum);
    }else{
        const prevIdxInShown=recentShown.indexOf(previousReplacement);
        if(prevIdxInShown===-1||prevIdxInShown+1>=recentShown.length){
            if(recentShown.length>0){
                const firstInShown=recentShown[0];
                const firstIdxInRecent=recent.indexOf(firstInShown);
                if(firstIdxInRecent!==-1){
                    recent.splice(firstIdxInRecent,1,camNum);
                }else{
                    recent.unshift(camNum);
                }
            }else{
                recent.unshift(camNum);
            }
        }else{
            const nextInShown=recentShown[prevIdxInShown+1];
            const nextIdxInRecent=recent.indexOf(nextInShown);
            if(nextIdxInRecent!==-1){
                recent.splice(nextIdxInRecent,1,camNum);
            }else{
                const prevIdxInRecent=recent.indexOf(previousReplacement);
                if(prevIdxInRecent!==-1&&prevIdxInRecent+1<recent.length){
                    recent.splice(prevIdxInRecent+1,1,camNum);
                }else{
                    recent.unshift(camNum);
                }
            }
        }
    }
    
    // Ensure recent contains all non-active cameras
    const allCameras=Array.from({length:26},(_,i)=>i+1);
    const nonActive=allCameras.filter(c=>!active.includes(c));
    const missing=nonActive.filter(c=>!recent.includes(c));
    // Add missing cameras at the end (they're the least recent)
    recent.push(...missing);
    
    previousReplacement=camNum;
    updateDisplay();
    console.log('Recent:',recent.slice(),'Recent_Shown:',getRecentShown(),'Active:',active.slice(),'Active_Shown:',getActiveShown(),'Previous_Replacement:',previousReplacement);
}

function updateDisplay(){
    if(updateDisplayTimeout)clearTimeout(updateDisplayTimeout);
    updateDisplayTimeout=setTimeout(()=>{
        // Ensure we have the fixed elements initialized
        if(!backgroundElements || backgroundElements.length!==16 || !activeWrappers || activeWrappers.length!==4){
            // If not initialized, we can't proceed - elements will be created on next init
            return;
        }
        
        const activeShown=getActiveShown();
        const recentShown=getRecentShown();
        
        // Remove all error overlays - they'll be recreated if needed
        document.querySelectorAll('.camera-error-overlay').forEach(overlay=>overlay.remove());
        
        const occupied=new Set();
        
        // Step 1: Handle active cameras - assign to fixed activeWrappers
        const activePositions = [
            {row:1,col:1},
            {row:1,col:3},
            {row:3,col:1},
            {row:3,col:3}
        ];
        
        for(let i=0; i<activeWrappers.length; i++){
            const wrapper = activeWrappers[i];
            const img = wrapper.querySelector('img');
            const label = wrapper.querySelector('.event-label');
            
            if(i < activeShown.length){
                const camNum = activeShown[i];
                const pos = activePositions[i];
                const eventType = activeEventTypes.get(camNum) || 'unknown';
                const priority = priorityMap.get(`${camNum}-${eventType}`) || 'low';
                
                // Update wrapper position
                wrapper.style.gridColumn = `${pos.col} / span 2`;
                wrapper.style.gridRow = `${pos.row} / span 2`;
                wrapper.style.display = '';
                
                // Update image
                img.dataset.camera = camNum.toString();
                img.className = 'active';
                setImageSource(img, camNum);
                
                // Update label
                label.className = `event-label ${priority}`;
                label.textContent = eventType;
                
                // Mark cells as occupied
                const cell1=(pos.row-1)*4+pos.col;
                const cell2=(pos.row-1)*4+pos.col+1;
                const cell3=pos.row*4+pos.col;
                const cell4=pos.row*4+pos.col+1;
            occupied.add(cell1);
            occupied.add(cell2);
            occupied.add(cell3);
            occupied.add(cell4);
                
                // Hide error overlay for active cameras
                if(typeof hideCameraError === 'function') {
                    hideCameraError(camNum);
                }
                wrapper.querySelectorAll('.camera-error-overlay').forEach(overlay => overlay.remove());
            }else{
                // Hide unused active wrappers
                wrapper.style.display = 'none';
            }
        }
        
        // Step 2: Handle recent cameras - assign to fixed backgroundElements
        // Determine positions for recent cameras based on number of active cameras
        let recentPositions = [];
        if(activeShown.length === 1){
            // With 1 active camera: 12 recent cameras - top-right + rows 3-4
            // Filter out occupied cells
            const candidatePositions = [
                {row:1,col:3},{row:1,col:4},{row:2,col:3},{row:2,col:4},
                {row:3,col:1},{row:3,col:2},{row:3,col:3},{row:3,col:4},
                {row:4,col:1},{row:4,col:2},{row:4,col:3},{row:4,col:4}
            ];
            for(const pos of candidatePositions){
                const cellId=(pos.row-1)*4+pos.col;
                if(!occupied.has(cellId)){
                    recentPositions.push(pos);
                }
            }
        }else if(activeShown.length === 2){
            // With 2 active cameras: 8 recent cameras - rows 3-4 only
            recentPositions = [
                {row:3,col:1},{row:3,col:2},{row:3,col:3},{row:3,col:4},
                {row:4,col:1},{row:4,col:2},{row:4,col:3},{row:4,col:4}
            ];
            // Filter out occupied cells (though with 2 active cameras, rows 3-4 should be free)
            recentPositions = recentPositions.filter(pos => {
                const cellId=(pos.row-1)*4+pos.col;
                return !occupied.has(cellId);
            });
        }else{
            // With 0, 3, or 4 active cameras: fill remaining positions
            for(let row=1;row<=4;row++){
                for(let col=1;col<=4;col++){
                    const cellId=(row-1)*4+col;
                    if(!occupied.has(cellId)){
                        recentPositions.push({row,col});
                    }
                }
            }
        }
        
        // First pass: Hide any background elements that are in occupied cells
        backgroundElements.forEach(wrapper => {
            if(!wrapper) return;
            
            const img = wrapper.querySelector('img');
            if(img && img.classList.contains('active')) return; // Skip active camera elements
            
            const gridRow = wrapper.style.gridRow || window.getComputedStyle(wrapper).gridRowStart || '';
            const gridCol = wrapper.style.gridColumn || window.getComputedStyle(wrapper).gridColumnStart || '';
            
            let row = null, col = null;
            
            // Parse row
            if(gridRow){
                const rowMatch = gridRow.match(/^(\d+)/);
                if(rowMatch) row = parseInt(rowMatch[1]);
            }
            
            // Parse col
            if(gridCol){
                const colMatch = gridCol.match(/^(\d+)/);
                if(colMatch) col = parseInt(colMatch[1]);
            }
            
            // If wrapper is in an occupied cell, hide it
            if(row && col){
                const cellId = (row-1)*4 + col;
                if(occupied.has(cellId)){
                    wrapper.style.display = 'none';
                }
            }
        });
        
        // Assign recent cameras to background elements (which are now wrappers)
        // Filter recentShown to exclude active cameras (in case there's overlap)
        const activeSet = new Set(activeShown);
        const recentToShow = recentShown.filter(cam => !activeSet.has(cam));
        
        let bgIndex = 0;
        for(let i=0; i<recentPositions.length && i<recentToShow.length && bgIndex<backgroundElements.length; i++){
            const pos = recentPositions[i];
            const camNum = recentToShow[i];
            const wrapper = backgroundElements[bgIndex];
            const img = wrapper.querySelector('img');
            
            if(!img) continue;
            
            // Skip if this element is marked as active
            if(img.classList.contains('active')) {
                bgIndex++;
                i--; // Retry this position
                continue;
            }
            
            // Update wrapper position
            wrapper.style.gridColumn = pos.col;
            wrapper.style.gridRow = pos.row;
            wrapper.style.display = '';
            
            // Update img element
            img.dataset.camera = camNum.toString();
            img.className = '';
            img.dataset.eventType = '';
            img.style.gridColumn = '';
            img.style.gridRow = '';
            img.style.display = '';
            setImageSource(img, camNum);
            bgIndex++;
        }
        
        // Hide unused background elements
        for(let i=bgIndex; i<backgroundElements.length; i++){
            backgroundElements[i].style.display = 'none';
        }
        
        // Restore error overlays for cameras that are marked as failed
        // Show errors for both active and recent cameras
        if(typeof cameraFailureStatus !== 'undefined' && typeof showCameraError === 'function') {
            // Show errors for active cameras
            activeShown.forEach(camNum => {
                if(cameraFailureStatus.get(camNum)) {
                    showCameraError(camNum);
                }
            });
            
            // Show errors for recent cameras (excluding active ones to avoid duplicates)
            const activeSet = new Set(activeShown);
            recentShown.forEach(camNum => {
                if(cameraFailureStatus.get(camNum) && !activeSet.has(camNum)) {
                    showCameraError(camNum);
                }
            });
        }
    },50);
}
