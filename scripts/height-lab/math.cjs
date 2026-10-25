/* Experimental graph-Laplacian interpolation with explicit Dirichlet values.
 * No object semantics, ground detection, or thickness estimation.
 */
function solveHeight(mask, width, height, constraints, maxIterations = 12000) {
  const size = width * height, values = new Float64Array(size), known = new Uint8Array(size);
  const visited = new Uint8Array(size), supported = new Uint8Array(size);
  const neighbors = i => {
    const x=i%width,y=Math.floor(i/width), out=[];
    if(x)out.push(i-1);if(x+1<width)out.push(i+1);
    if(y)out.push(i-width);if(y+1<height)out.push(i+width);
    return out.filter(j=>mask[j]);
  };
  let unsupported=0, components=0;
  for(let start=0;start<size;start++) {
    if(!mask[start]||visited[start])continue;
    components++;
    const component=[start];visited[start]=1;let sum=0,count=0;
    for(let k=0;k<component.length;k++) {
      const i=component[k];
      if(Number.isFinite(constraints[i])&&constraints[i]>=0){sum+=constraints[i];count++;known[i]=1;}
      for(const j of neighbors(i))if(!visited[j]){visited[j]=1;component.push(j);}
    }
    if(!count){unsupported+=component.length;continue;}
    for(const i of component){supported[i]=1;values[i]=known[i]?constraints[i]:sum/count;}
  }
  const free=[];for(let i=0;i<size;i++)if(supported[i]&&!known[i])free.push([i,neighbors(i)]);
  // Standard Jacobi-preconditioned conjugate gradient on the Dirichlet Laplacian.
  const r=new Float64Array(size),p=new Float64Array(size),ap=new Float64Array(size);
  let iterations=0,residual=0,rz=0;
  const tolerance=1e-5;
  for(const [i,adj] of free){let sum=0;for(const j of adj)sum+=values[j];r[i]=sum-adj.length*values[i];p[i]=r[i]/adj.length;rz+=r[i]*p[i];residual=Math.max(residual,Math.abs(p[i]));}
  for(;iterations<maxIterations&&residual>=tolerance;iterations++) {
    let pap=0;
    for(const [i,adj] of free){let sum=0;for(const j of adj)if(!known[j])sum+=p[j];ap[i]=adj.length*p[i]-sum;pap+=p[i]*ap[i];}
    if(!(pap>0))break;
    const step=rz/pap;let next=0;residual=0;
    for(const [i,adj] of free){values[i]+=step*p[i];r[i]-=step*ap[i];const z=r[i]/adj.length;next+=r[i]*z;residual=Math.max(residual,Math.abs(z));}
    const beta=next/rz;
    for(const [i,adj] of free)p[i]=r[i]/adj.length+beta*p[i];
    rz=next;
  }
  return {values,supported,unsupported,components,iterations,residual,converged:residual<tolerance};
}

function projectGround(u,v,h,lightX,lightV,lightHeight,angle) {
  if(lightHeight<=h||angle<=0||angle>=Math.PI/2) return null;
  const sin=Math.sin(angle),cos=Math.cos(angle);
  const z=(v+h*cos)/sin,lz=lightV/sin,t=lightHeight/(lightHeight-h);
  return [lightX+(u-lightX)*t,(lz+(z-lz)*t)*sin];
}

if(typeof module!=='undefined')module.exports={solveHeight,projectGround};
