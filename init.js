function createBackgroundGrid(){
    for(let i=0;i<16;i++){
        const img=document.createElement('img');
        document.body.appendChild(img);
    }
}

function initialize(){
    createBackgroundGrid();
    recent.push(...Array.from({length:26},(_,i)=>26-i));
    previousReplacement=null;
    for(let cam=1;cam<=26;cam++){
        preloadImage(cam).catch(()=>{});
    }
    updateDisplay();
    loadPriorities();
}

initialize();
