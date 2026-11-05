import { makeBackup,readBackup } from './backup';
import { friendlyError } from './domain';
self.onmessage=async e=>{try{const result=e.data.action==='make'?await makeBackup(e.data.bundle,e.data.password):await readBackup(e.data.bytes,e.data.password);self.postMessage({result});}catch(error){self.postMessage({error:friendlyError(error)});}};
