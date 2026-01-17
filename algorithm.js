const recent=[];
const active=[];
let previousReplacement=null;
const activeQueue=new Map();
const activeEventTypes=new Map();

let updateDisplayTimeout=null;

function getRecentShown(){
    const activeCount=active.length;
    let countToShow=16;
    if(activeCount===1)countToShow=12;
    else if(activeCount===3)countToShow=8;
    else if(activeCount>=4)countToShow=0;
    return recent.filter(c=>!active.includes(c)).slice(0,countToShow);
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
    const timeoutId=setTimeout(()=>onCameraDeactivate(camNum),10000);
    activeQueue.set(camNum,timeoutId);
    
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
    
    previousReplacement=camNum;
    updateDisplay();
    console.log('Recent:',recent.slice(),'Recent_Shown:',getRecentShown(),'Active:',active.slice(),'Active_Shown:',getActiveShown(),'Previous_Replacement:',previousReplacement);
}

function updateDisplay(){
    if(updateDisplayTimeout)clearTimeout(updateDisplayTimeout);
    updateDisplayTimeout=setTimeout(()=>{
        const imgs=[];
        document.querySelectorAll('body>img,body>.event-wrapper>img').forEach(el=>{
            imgs.push(el.parentElement.classList.contains('event-wrapper')?el.parentElement:el);
        });
        while(imgs.length<16){
            const img=document.createElement('img');
            document.body.appendChild(img);
            imgs.push(img);
        }
        const activeShown=getActiveShown();
        const recentShown=getRecentShown();
        
        const occupied=new Set();
        let imgIndex=0;
        
        for(let activeIdx=0;activeIdx<activeShown.length;activeIdx++){
            if(imgIndex>=imgs.length)break;
            const camNum=activeShown[activeIdx];
            
            let row,col;
            if(activeIdx===0){
                row=1;
                col=1;
            }else{
                let found=false;
                for(let r=1;r<=3;r++){
                    for(let c=1;c<=3;c++){
                        const cell1=(r-1)*4+c;
                        const cell2=(r-1)*4+c+1;
                        const cell3=r*4+c;
                        const cell4=r*4+c+1;
                        if(!occupied.has(cell1)&&!occupied.has(cell2)&&
                           !occupied.has(cell3)&&!occupied.has(cell4)){
                            row=r;
                            col=c;
                            found=true;
                            break;
                        }
                    }
                    if(found)break;
                }
                if(!found)break;
            }
            
            let img=imgs[imgIndex];
            const eventType=activeEventTypes.get(camNum)||'unknown';
            const priority=priorityMap.get(`${camNum}-${eventType}`)||'low';
            
            let wrapper=img.parentElement;
            if(!wrapper||!wrapper.classList.contains('event-wrapper')){
                wrapper=document.createElement('div');
                wrapper.className='event-wrapper';
                wrapper.style.gridColumn=img.style.gridColumn;
                wrapper.style.gridRow=img.style.gridRow;
                wrapper.style.display=img.style.display;
                img.style.gridColumn='';
                img.style.gridRow='';
                img.style.display='';
                img.parentNode.replaceChild(wrapper,img);
                wrapper.appendChild(img);
            }
            
            img.dataset.camera=camNum;
            img.className='active';
            wrapper.style.gridColumn=`${col} / span 2`;
            wrapper.style.gridRow=`${row} / span 2`;
            wrapper.style.display='';
            
            let label=wrapper.querySelector('.event-label');
            if(!label){
                label=document.createElement('span');
                label.className='event-label';
                wrapper.appendChild(label);
            }
            label.className=`event-label ${priority}`;
            label.textContent=eventType;
            
            const elementAfterSet=setImageSource(img,camNum);
            if(elementAfterSet&&elementAfterSet.parentElement!==wrapper){
                wrapper.replaceChild(elementAfterSet,img);
            }
            
            const cell1=(row-1)*4+col;
            const cell2=(row-1)*4+col+1;
            const cell3=row*4+col;
            const cell4=row*4+col+1;
            occupied.add(cell1);
            occupied.add(cell2);
            occupied.add(cell3);
            occupied.add(cell4);
            imgIndex++;
        }
        
        let recentIndex=0;
        
        if(activeShown.length===1){
            const recentPositions=[
                {row:1,col:3},{row:1,col:4},{row:2,col:3},{row:2,col:4},
                {row:3,col:1},{row:3,col:2},{row:3,col:3},{row:3,col:4},
                {row:4,col:1},{row:4,col:2},{row:4,col:3},{row:4,col:4}
            ];
            for(const pos of recentPositions){
                if(imgIndex>=imgs.length||recentIndex>=recentShown.length)break;
                const cellId=(pos.row-1)*4+pos.col;
                if(!occupied.has(cellId)){
                    const camNum=recentShown[recentIndex];
                    if(camNum){
                        let img=imgs[imgIndex];
                        let wrapper=img.parentElement;
                        if(wrapper&&wrapper.classList.contains('event-wrapper')){
                            wrapper.parentNode.replaceChild(img,wrapper);
                            wrapper.remove();
                        }
                        img.dataset.camera=camNum;
                        img.className='';
                        img.dataset.eventType='';
                        img.style.gridColumn=pos.col;
                        img.style.gridRow=pos.row;
                        img.style.display='';
                        setImageSource(img,camNum);
                        imgIndex++;
                        recentIndex++;
                    }
                }
            }
        }else{
            for(let row=1;row<=4;row++){
                for(let col=1;col<=4;col++){
                    if(imgIndex>=imgs.length||recentIndex>=recentShown.length)break;
                    const cellId=(row-1)*4+col;
                    if(!occupied.has(cellId)){
                        const camNum=recentShown[recentIndex];
                        if(camNum){
                            let img=imgs[imgIndex];
                            let wrapper=img.parentElement;
                            if(wrapper&&wrapper.classList.contains('event-wrapper')){
                                wrapper.parentNode.replaceChild(img,wrapper);
                                wrapper.remove();
                            }
                            img.dataset.camera=camNum;
                            img.className='';
                            img.dataset.eventType='';
                            img.style.gridColumn=col;
                            img.style.gridRow=row;
                            img.style.display='';
                            setImageSource(img,camNum);
                            imgIndex++;
                            recentIndex++;
                        }
                    }
                }
                if(imgIndex>=imgs.length||recentIndex>=recentShown.length)break;
            }
        }
        
        for(let i=imgIndex;i<imgs.length;i++){
            imgs[i].style.display='none';
        }
    },50);
}
