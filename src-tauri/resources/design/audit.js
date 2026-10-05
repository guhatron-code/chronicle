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
    if(el.id)return '#'+CSS.escape(el.id);
    var parts=[];var cur=el;
    while(cur&&cur!==document.body&&parts.length<4){var s=cur.tagName.toLowerCase();var cls=(cur.className&&typeof cur.className==='string')?cur.className.trim().split(/\s+/).filter(Boolean).slice(0,2).map(function(c){return '.'+CSS.escape(c)}).join(''):'';if(cls)s+=cls;var p=cur.parentElement;if(p){var same=Array.prototype.filter.call(p.children,function(x){return x.tagName===cur.tagName});if(same.length>1)s+=':nth-of-type('+(same.indexOf(cur)+1)+')'}parts.unshift(s);cur=p}
    return parts.join(' > ');
  }
  function visible(el){var r=el.getBoundingClientRect();if(r.width===0||r.height===0)return false;var cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none'&&parseFloat(cs.opacity)>0}
  function textOf(el){return Array.prototype.filter.call(el.childNodes,function(n){return n.nodeType===3}).map(function(n){return n.textContent}).join('').trim()}
  var INTERACTIVE='a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[tabindex]:not([tabindex="-1"])';
  window.__chronicleAudit=function(opts){
    opts=opts||{};var width=opts.width||innerWidth;var fold=opts.fold||innerHeight;var kind=opts.kind||'app';
    var out=[];var seen=0;
    function add(rule,severity,text,el){out.push({rule:rule,severity:severity,text:text,selector:el?sel(el):undefined})}
    // 1 · contrast, every element with its own text
    var all=document.body.querySelectorAll('*');
    for(var i=0;i<all.length&&seen<4000;i++){var el=all[i];var t=textOf(el);if(!t||t.length<2||!visible(el))continue;seen++;
      var cs=getComputedStyle(el);var fg=parseColor(cs.color);var bg=bgOf(el);if(!fg||!bg)continue;if(fg[3]<1)fg=over(fg,bg);
      var ratio=contrast(fg,bg);var px=parseFloat(cs.fontSize);var w=parseInt(cs.fontWeight,10)||400;var need=isLarge(px,w)?3:4.5;
      if(ratio<need)add('contrast',ratio<need-1?'severe':'minor','Text at '+ratio.toFixed(1)+':1 needs '+need+':1: “'+t.slice(0,40)+'”',el)}
    // 2 · targets and focus
    var floor=minTarget(width);var inter=document.querySelectorAll(INTERACTIVE);
    for(var j=0;j<inter.length;j++){var it=inter[j];if(!visible(it))continue;var r=it.getBoundingClientRect();
      if(r.width<floor||r.height<floor)add('target','minor','A control is '+Math.round(r.width)+'×'+Math.round(r.height)+' px; the floor at this width is '+floor+' px',it);
      var f=getComputedStyle(it);if(f.outlineStyle==='none'){try{it.classList.add('__chronicle-focus');}catch(e){}}
    }
    // outline:none without a focus-visible replacement: report once per page when any control has outline none and no sheet mentions focus
    var sheetsMention=false;try{for(var s=0;s<document.styleSheets.length;s++){var rules=document.styleSheets[s].cssRules;for(var k=0;k<rules.length;k++){if(/focus-visible|:focus/.test(rules[k].cssText)){sheetsMention=true;break}}if(sheetsMention)break}}catch(e){sheetsMention=true}
    if(!sheetsMention&&document.querySelector('.__chronicle-focus'))add('focus','minor','Controls remove the outline and no style gives keyboard focus another look',document.querySelector('.__chronicle-focus'));
    Array.prototype.forEach.call(document.querySelectorAll('.__chronicle-focus'),function(x){x.classList.remove('__chronicle-focus')});
    // 3 · images, headings, viewport
    Array.prototype.forEach.call(document.images,function(img){if(!img.hasAttribute('alt'))add('alt','minor','An image has no alt text',img)});
    var last=0;Array.prototype.forEach.call(document.querySelectorAll('h1,h2,h3,h4,h5,h6'),function(h){var n=+h.tagName[1];if(last&&n>last+1)add('headings','minor','Heading order jumps from h'+last+' to h'+n,h);last=n});
    if(!document.querySelector('meta[name=viewport]'))add('viewport','minor','The page has no viewport meta');
    // 4 · overflow and fonts
    if(document.documentElement.scrollWidth>width+1)add('overflow','severe','The page is wider than its frame ('+document.documentElement.scrollWidth+' px for '+width+')');
    try{var res=performance.getEntriesByType('resource');res.forEach(function(e){if(/\.(woff2?|ttf|otf)(\?|$)/i.test(e.name)&&!/^chronicle-file:/.test(e.name))add('fonts','severe','A font loads from outside the design: '+e.name.slice(0,80))});
      Array.prototype.forEach.call(document.querySelectorAll('link[href]'),function(l){if(/fonts\.googleapis|fonts\.gstatic|typekit|fonts\.bunny/i.test(l.href))add('fonts','severe','A font service is linked: '+l.href.slice(0,80),l)})}catch(e){}
    // 5 · raw colours without a custom property (minor, counted per value)
    var counts={};for(var q=0;q<all.length&&q<4000;q++){var st=all[q].getAttribute('style')||'';var mm=st.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi);if(mm)mm.forEach(function(c){counts[c]=(counts[c]||0)+1})}
    Object.keys(counts).forEach(function(c){if(counts[c]>3)add('tokens','minor','The colour '+c+' is written '+counts[c]+' times without a custom property')});
    // 6 · kind rules
    var foldTop=function(el){return el.getBoundingClientRect().top+scrollY<fold};
    var primary=Array.prototype.filter.call(inter,function(b){return /button|submit/i.test(b.tagName+' '+(b.getAttribute('type')||''))||b.getAttribute('role')==='button'}).filter(visible);
    if(!primary.some(foldTop))add('primary-above-fold','minor','No primary action sits in the first screen');
    if(kind==='ecommerce'){
      var text=document.body.innerText||'';
      var priceEl=Array.prototype.find.call(all,function(e){return /[$€£]\s?\d|\d\s?(USD|EUR|GBP)/.test(textOf(e))&&visible(e)});
      if(!priceEl||!foldTop(priceEl))add('ecom-price','severe','The price is not in the first screen',priceEl);
      if(!/deliver|shipping|arrives|dispatch/i.test(text))add('ecom-delivery','severe','Delivery or shipping information is missing');
      if(!/return/i.test(text))add('ecom-returns','minor','The returns policy is not named');
      var cart=Array.prototype.find.call(primary,function(b){return /add to (cart|bag|basket)|buy/i.test(b.textContent||'')});
      if(cart&&!foldTop(cart))add('ecom-cta','severe','Add to cart is below the first screen on this width',cart);
    }
    return JSON.stringify(out);
  };
  window.__chronicleAuditLib={contrast:contrast,parseColor:parseColor,luminance:luminance,isLarge:isLarge,minTarget:minTarget};
})();
</script>
