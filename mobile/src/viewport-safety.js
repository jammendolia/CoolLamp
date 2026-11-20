export function expandedDetailsNeedsReveal({summaryTop,firstControlBottom,topLimit,bottomLimit}) {
  return Number.isFinite(summaryTop)&&Number.isFinite(firstControlBottom)&&
    (summaryTop<topLimit||firstControlBottom>bottomLimit);
}

function visibleFirstControl(details) {
  const controls=details.querySelectorAll('button,input,select,textarea,[role="status"]');
  for(const control of controls) {
    if(control.hidden||control.getAttribute?.('aria-hidden')==='true')continue;
    const rects=control.getClientRects?.();
    if(!rects||rects.length)return control;
  }
  return details.querySelector('summary')?.nextElementSibling||details;
}

export function mountViewportSafety({document=globalThis.document,window=globalThis.window}={}) {
  if(!document?.addEventListener||!window)return()=>{};
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  const reveal=details=>window.requestAnimationFrame(()=>{
    if(!details.open||details.isConnected===false)return;
    const summary=details.querySelector('summary');
    if(!summary)return;
    const dialog=details.closest?.('dialog[open]');
    const main=document.getElementById?.('app');
    const mainTop=Number.parseFloat(main?window.getComputedStyle?.(main)?.paddingTop:'')||22;
    const navigation=document.querySelector?.('nav[aria-label="Main navigation"]');
    const toast=document.getElementById?.('toast');
    const dialogRect=dialog?.getBoundingClientRect?.();
    const topLimit=dialogRect?dialogRect.top+16:mainTop+8;
    let bottomLimit=dialogRect?dialogRect.bottom-16:(navigation?.getBoundingClientRect?.().top||window.innerHeight);
    if(!toast?.hidden)bottomLimit=Math.min(bottomLimit,toast.getBoundingClientRect().top);
    const summaryTop=summary.getBoundingClientRect().top;
    const firstControlBottom=visibleFirstControl(details).getBoundingClientRect().bottom;
    if(expandedDetailsNeedsReveal({summaryTop,firstControlBottom,topLimit,bottomLimit}))
      summary.scrollIntoView({block:'start',behavior:reduced?'auto':'smooth'});
  });
  const onToggle=event=>{const details=event.target;if(details?.tagName==='DETAILS'&&details.open)reveal(details);};
  document.addEventListener('toggle',onToggle,true);
  return()=>document.removeEventListener('toggle',onToggle,true);
}
