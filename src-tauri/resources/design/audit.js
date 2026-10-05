<script>
(function(){
  function parseColor(s){
    if(!s)return null; s=String(s).trim().toLowerCase();
    if(s==='transparent')return [0,0,0,0];
    var m=s.match(/^rgba?\(([^)]+)\)$/);
    if(m){var p=m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);if(p.length<3||p.some(isNaN))return null;return [p[0],p[1],p[2],p.length>3?p[3]:1]}
    m=s.match(/^#([0-9a-f]{3,8})$/);
    if(m){var h=m[1];if(h.length===3||h.length===4)h=h.split('').map(function(c){return c+c}).join('');var n=parseInt(h.slice(0,6),16);var a=h.length===8?parseInt(h.slice(6,8),16)/255:1;return [(n>>16)&255,(n>>8)&255,n&255,a]}
    return null;
  }
  function chan(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)}
  function luminance(c){return 0.2126*chan(c[0])+0.7152*chan(c[1])+0.0722*chan(c[2])}
  function over(fg,bg){var a=fg[3];return [fg[0]*a+bg[0]*(1-a),fg[1]*a+bg[1]*(1-a),fg[2]*a+bg[2]*(1-a),1]}
  function contrast(a,b){var l1=luminance(a),l2=luminance(b);var hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05)}
  function isLarge(px,weight){return px>=18||(weight>=700&&px>=14)}
  function minTarget(width){return width<=768?44:24}
  function bgOf(el){
    while(el&&el!==document.documentElement){var cs=getComputedStyle(el);var c=parseColor(cs.backgroundColor);if(c&&c[3]>0)return c;if(cs.backgroundImage&&cs.backgroundImage!=='none')return null;el=el.parentElement}
    var root=parseColor(getComputedStyle(document.documentElement).backgroundColor);var bodyc=parseColor(getComputedStyle(document.body).backgroundColor);
    return (bodyc&&bodyc[3]>0)?bodyc:(root&&root[3]>0)?root:[255,255,255,1];
  }
  function sel(el){
    if(!window.CSS||!CSS.escape)return el.tagName.toLowerCase();
    if(el.id)return '#'+CSS.escape(el.id);
    var parts=[];var cur=el;
    while(cur&&cur!==document.body&&parts.length<4){var s=cur.tagName.toLowerCase();var cls=(cur.className&&typeof cur.className==='string')?cur.className.trim().split(/\s+/).filter(Boolean).slice(0,2).map(function(c){return '.'+CSS.escape(c)}).join(''):'';if(cls)s+=cls;var p=cur.parentElement;if(p){var same=Array.prototype.filter.call(p.children,function(x){return x.tagName===cur.tagName});if(same.length>1)s+=':nth-of-type('+(same.indexOf(cur)+1)+')'}parts.unshift(s);cur=p}
    return parts.join(' > ');
  }
  function visible(el){var r=el.getBoundingClientRect();if(r.width===0||r.height===0)return false;var cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none'&&parseFloat(cs.opacity)>0}
  function textOf(el){return Array.prototype.filter.call(el.childNodes,function(n){return n.nodeType===3}).map(function(n){return n.textContent}).join('').trim()}
  var INTERACTIVE='a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[tabindex]:not([tabindex="-1"])';
  function walk(rules,fn){for(var i=0;i<rules.length;i++){var r=rules[i];if(r.selectorText)fn(r);if(r.cssRules)walk(r.cssRules,fn)}}
  function isPrimary(b){
    var t=b.tagName;
    if(t==='BUTTON'||b.getAttribute('role')==='button'||(t==='INPUT'&&/submit|button/i.test(b.type||'')))return true;
    if(t!=='A')return false;
    var cn=typeof b.className==='string'?b.className:'';if(/btn|button|cta/i.test(cn))return true;
    var cs=getComputedStyle(b);var bg=parseColor(cs.backgroundColor);
    return !!(bg&&bg[3]>0&&parseFloat(cs.paddingTop)>0&&parseFloat(cs.paddingBottom)>0&&parseFloat(cs.paddingLeft)>0&&parseFloat(cs.paddingRight)>0);
  }
  window.__chronicleAudit=function(opts){
    opts=opts||{};var width=opts.width||window.innerWidth;var fold=opts.fold||window.innerHeight;var kind=opts.kind||'app';
    var out=[];var counts={};var all=[];var inter=[];
    function add(rule,severity,text,el){
      counts[rule]=(counts[rule]||0)+1;if(counts[rule]>20)return;
      var s;if(el){try{s=sel(el)}catch(e){}}
      out.push({rule:rule,severity:severity,text:text,selector:s})}
    function section(name,fn){try{fn()}catch(e){out.push({rule:'audit-error',severity:'minor',text:'Part of the audit could not run: '+name})}}
    var foldTop=function(el){return el.getBoundingClientRect().top+window.scrollY<fold};
    section('contrast',function(){
      all=document.body.querySelectorAll('*');
      for(var i=0;i<all.length&&i<4000;i++){var el=all[i];var t=textOf(el);if(!t||t.length<2||!visible(el))continue;
        var cs=getComputedStyle(el);var fg=parseColor(cs.color);var bg=bgOf(el);if(!fg||!bg)continue;if(fg[3]<1)fg=over(fg,bg);
        var ratio=contrast(fg,bg);var px=parseFloat(cs.fontSize);var w=parseInt(cs.fontWeight,10)||400;var need=isLarge(px,w)?3:4.5;
        if(ratio<need)add('contrast',ratio<need-1?'severe':'minor','Text at '+ratio.toFixed(1)+':1 needs '+need+':1: “'+t.slice(0,40)+'”',el)}});
    section('targets',function(){
      var floor=minTarget(width);inter=document.querySelectorAll(INTERACTIVE);
      for(var j=0;j<inter.length&&j<4000;j++){var it=inter[j];if(!visible(it))continue;var r=it.getBoundingClientRect();
        if(r.width>=floor&&r.height>=floor)continue;
        // WCAG 2.5.8: an inline text link inside a sentence is exempt
        if(it.tagName==='A'&&getComputedStyle(it).display==='inline'&&it.parentElement&&textOf(it.parentElement))continue;
        add('target','minor','A control is '+Math.round(r.width)+'×'+Math.round(r.height)+' px; the floor at this width is '+floor+' px',it)}});
    section('focus',function(){
      // outline removed by a stylesheet rule, with no :focus / :focus-visible rule anywhere to replace it
      var bad=null,hasFocus=false;
      for(var s=0;s<document.styleSheets.length;s++){try{walk(document.styleSheets[s].cssRules,function(r){
        if(/:focus/.test(r.selectorText)){hasFocus=true;return}
        if(!bad&&/outline(-style)?\s*:\s*none|outline(-width)?\s*:\s*0(?![.\d])/i.test(r.style?r.style.cssText:r.cssText))bad=r})}catch(e){}}
      if(bad&&!hasFocus){var el=null;try{el=document.querySelector(bad.selectorText)}catch(e){}
        add('focus','minor','A style removes the focus outline and no :focus or :focus-visible style replaces it',el)}});
    section('images and headings',function(){
      Array.prototype.forEach.call(document.images,function(img){if(!img.hasAttribute('alt'))add('alt','minor','An image has no alt text',img)});
      var last=0;Array.prototype.forEach.call(document.querySelectorAll('h1,h2,h3,h4,h5,h6'),function(h){var n=+h.tagName[1];if(last&&n>last+1)add('headings','minor','Heading order jumps from h'+last+' to h'+n,h);last=n});
      if(!document.querySelector('meta[name=viewport]'))add('viewport','minor','The page has no viewport meta')});
    section('overflow',function(){
      if(document.documentElement.scrollWidth>width+1)add('overflow','severe','The page is wider than its frame ('+document.documentElement.scrollWidth+' px for '+width+')')});
    section('fonts',function(){
      window.performance.getEntriesByType('resource').forEach(function(e){if(/\.(woff2?|ttf|otf)(\?|$)/i.test(e.name)&&!/^chronicle-file:/.test(e.name))add('fonts','severe','A font loads from outside the design: '+e.name.slice(0,80))});
      Array.prototype.forEach.call(document.querySelectorAll('link[href]'),function(l){if(/fonts\.googleapis|fonts\.gstatic|typekit|fonts\.bunny/i.test(l.href))add('fonts','severe','A font service is linked: '+l.href.slice(0,80),l)})});
    section('tokens',function(){
      var counts2={};for(var q=0;q<all.length&&q<4000;q++){var st=all[q].getAttribute('style')||'';var mm=st.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi);if(mm)mm.forEach(function(c){counts2[c]=(counts2[c]||0)+1})}
      Object.keys(counts2).forEach(function(c){if(counts2[c]>3)add('tokens','minor','The colour '+c+' is written '+counts2[c]+' times without a custom property')})});
    var primary=[];
    section('primary action',function(){
      primary=Array.prototype.filter.call(inter,isPrimary).filter(visible);
      if(!primary.some(foldTop))add('primary-above-fold','minor','No primary action sits in the first screen')});
    if(kind==='ecommerce')section('e-commerce',function(){
      var text=document.body.innerText||'';
      var priceEl=Array.prototype.find.call(all,function(e){return /[$€£]\s?\d|\d\s?(USD|EUR|GBP)/.test(textOf(e))&&visible(e)});
      if(!priceEl||!foldTop(priceEl))add('ecom-price','severe','The price is not in the first screen',priceEl);
      if(!/deliver|shipping|arrives|dispatch/i.test(text))add('ecom-delivery','severe','Delivery or shipping information is missing');
      if(!/return/i.test(text))add('ecom-returns','minor','The returns policy is not named');
      var cart=Array.prototype.find.call(primary,function(b){return /add to (cart|bag|basket)|buy/i.test(b.textContent||'')});
      if(cart&&!foldTop(cart))add('ecom-cta','severe','Add to cart is below the first screen on this width',cart)});
    return JSON.stringify(out);
  };
  window.__chronicleAuditLib={contrast:contrast,parseColor:parseColor,luminance:luminance,isLarge:isLarge,minTarget:minTarget};
})();
</script>
