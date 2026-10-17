type RouteTarget = {
  loadURL(url:string):Promise<unknown>;
  loadFile(file:string,options?:{hash:string}):Promise<unknown>;
  isDestroyed():boolean;
};

/** An orphaned development window can outlive Vite; keep its route usable offline. */
export async function loadWindowRoute(target:RouteTarget,indexFile:string,devUrl?:string,hash?:string,onDevelopmentFailure?:(error:unknown)=>void):Promise<void> {
  if(devUrl) {
    try {await target.loadURL(hash?`${devUrl}#${hash}`:devUrl);return;}
    catch(error) {
      if(target.isDestroyed())return;
      onDevelopmentFailure?.(error);
    }
  }
  if(!target.isDestroyed())await target.loadFile(indexFile,hash?{hash}:undefined);
}
