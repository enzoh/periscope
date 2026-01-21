// Fixed elements: 16 background grid cells and 4 active camera wrappers
let backgroundElements = [];
let activeWrappers = [];

function createBackgroundGrid(){
    // Clean up any old images or wrappers directly in body
    // (in case old code left them there)
    // Preserve script tags and event-wrappers (but we'll recreate those anyway)
    Array.from(document.body.children).forEach(child => {
        if(child.tagName === 'SCRIPT') {
            // Keep script tags
            return;
        }
        if(child.tagName === 'IMG' || (child.tagName === 'DIV')) {
            // Remove old images or divs (we'll recreate the wrapper structure)
            child.remove();
        }
    });
    
    // Create 16 fixed wrapper divs for the background grid
    // Each wrapper contains an img and can contain an error overlay
    backgroundElements = [];
    for(let i=0;i<16;i++){
        const wrapper=document.createElement('div');
        wrapper.style.position='relative';
        wrapper.style.width='100%';
        wrapper.style.height='100%';
        
        const img=document.createElement('img');
        wrapper.appendChild(img);
        
        document.body.appendChild(wrapper);
        backgroundElements.push(wrapper);
    }
    
    // Create 4 fixed event-wrapper divs for active cameras (2x2 overlay)
    activeWrappers = [];
    const positions = [
        {row:1,col:1},
        {row:1,col:3},
        {row:3,col:1},
        {row:3,col:3}
    ];
    
    for(let i=0;i<4;i++){
        const wrapper=document.createElement('div');
        wrapper.className='event-wrapper';
        wrapper.style.gridColumn=`${positions[i].col} / span 2`;
        wrapper.style.gridRow=`${positions[i].row} / span 2`;
        wrapper.style.display='none'; // Hidden by default
        const img=document.createElement('img');
        img.className='active';
        wrapper.appendChild(img);
        
        const label=document.createElement('span');
        label.className='event-label';
        wrapper.appendChild(label);
        
        document.body.appendChild(wrapper);
        activeWrappers.push(wrapper);
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
