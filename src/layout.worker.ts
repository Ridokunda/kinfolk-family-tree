import ELK from 'elkjs/lib/elk.bundled.js';
const elk=new ELK();
self.onmessage=async e=>{try{const graph=await elk.layout({id:'root',layoutOptions:{'elk.algorithm':'layered','elk.direction':'DOWN','elk.spacing.nodeNode':'35','elk.layered.spacing.nodeNodeBetweenLayers':'75','elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX'},children:e.data.ids.map((id:string)=>({id,width:196,height:102})),edges:e.data.edges});self.postMessage({positions:graph.children?.map(n=>({id:n.id,x:n.x||0,y:n.y||0}))});}catch{self.postMessage({error:'Automatic layout could not complete.'});}};
