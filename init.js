function createBackgroundGrid(){
    for(let i=0;i<16;i++){
        const img=document.createElement('img');
        document.body.appendChild(img);
    }
}

function initialize(){
    createBackgroundGrid();
    setLiveFeedSources();
    recent.push(...Array.from({length:26},(_,i)=>i+1));
    previousReplacement=null;
    for(let cam=1;cam<=26;cam++){
        preloadImage(cam).catch(()=>{});
    }
    updateDisplay();
    loadPriorities();
}

initialize();
