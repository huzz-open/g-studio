import { fitCameraSilhouette } from './camera-registration'
self.onmessage=event=>{try{const {positions,pixels}=event.data;self.postMessage({result:fitCameraSilhouette(positions,pixels,{pitchRange:[5,80]},progress=>self.postMessage({progress}))})}catch(error){self.postMessage({error:String(error)})}}
