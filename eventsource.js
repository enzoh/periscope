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
            console.error('Error parsing event data:',e);
        }
    };
    eventSource.onerror=()=>{
        if(eventSource.readyState===EventSource.CLOSED){
            console.error('EventSource connection closed');
        }
    };
}

async function loadPriorities(){
    try{
        const response=await fetch('priorities.json');
        const config=await response.json();
        const {events,highPriorityIndices}=config;
        const m=new Map();
        for(let cam=1;cam<=highPriorityIndices.length;cam++){
            const high=highPriorityIndices[cam-1]?.map(i=>events[i])||[];
            const low=events.filter(e=>!high.includes(e));
            high.forEach(e=>m.set(`${cam}-${e}`,'high'));
            low.forEach(e=>m.set(`${cam}-${e}`,'low'));
        }
        priorityMap=m;
        initEventSource();
    }catch(e){
        console.error('Error loading priorities:',e);
        initEventSource();
    }
}
