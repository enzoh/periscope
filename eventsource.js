let priorityMap=new Map();
let eventSource=null;

function getRandomCamera(){
    const available=Array.from({length:26},(_,i)=>i+1).filter(c=>!active.includes(c));
    return available.length?available[Math.floor(Math.random()*available.length)]:Math.floor(Math.random()*26)+1;
}

function initEventSource(){
    eventSource=new EventSource('/api/v1/subscribe');
    eventSource.onmessage=(event)=>{
        try{
            const data=JSON.parse(event.data);
            const camNum=data.camera?parseInt(data.camera):getRandomCamera();
            const eventType=data.event_type||'unknown';
            if(!camNum||isNaN(camNum))return;
            onCameraActivate(camNum,eventType);
        }catch(e){
            // Silently ignore parsing errors
        }
    };
    eventSource.onerror=(err)=>{
        // Silently handle errors
    };
}

async function loadPriorities(){
    try{
        const response=await fetch('priorities.json');
        if(!response.ok){
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const config=await response.json();
        if(!config||typeof config!=='object'){
            throw new Error('Invalid config format');
        }
        const m=new Map();
        for(const [camNum,camConfig] of Object.entries(config)){
            if(!camConfig||typeof camConfig!=='object')continue;
            const cam=parseInt(camNum);
            if(isNaN(cam))continue;
            const {events}=camConfig;
            if(!events||typeof events!=='object')continue;
            for(const [eventType,priority] of Object.entries(events)){
                const normalizedEvent=eventType.replace(/_/g,'-');
                m.set(`${cam}-${normalizedEvent}`,priority.toLowerCase());
            }
        }
        priorityMap=m;
        initEventSource();
    }catch(e){
        initEventSource();
    }
}
