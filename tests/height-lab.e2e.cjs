const {chromium}=require('C:/Users/19796/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file:///C:/Users/19796/.codex/visualizations/2026/10/25/01a171be-7c27-7b11-b588-85276f88de6e/pure-algorithm-height/height-lab.html');
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('求解完成'));
 await page.click('#clear');await page.click('#solve');assert((await page.textContent('#status')).includes('请先添加'));
 for(const id of ['10','15','17']){
  await page.selectOption('#asset',id);
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('求解完成'));
  await page.click('#example');await page.click('#solve');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('求解完成')||document.querySelector('#status').textContent.includes('迭代上限'),{},{timeout:90000});
  console.log(id,await page.textContent('#status'));
  assert((await page.textContent('#status')).includes('求解完成'));
  await page.screenshot({path:`node_modules/.cache/height-lab-${id}.png`,fullPage:true});
 }
 await page.click('#clear');assert(await page.locator('#export').isDisabled());
 await page.click('#undo');await page.click('#solve');
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('求解完成'));
 const before=await page.locator('#preview').evaluate(c=>c.toDataURL());
 assert.equal(await page.locator('#follow').count(),0);const box=await page.locator('#preview').boundingBox();
 await page.mouse.move(box.x+box.width*.8,box.y+box.height*.3);
 assert.notEqual(await page.locator('#preview').evaluate(c=>c.toDataURL()),before);
 const paint=await page.locator('#paint').boundingBox();
 await page.mouse.click(paint.x+paint.width*.5,paint.y+paint.height*.6);
 assert(await page.locator('#export').isDisabled());
 assert((await page.textContent('#status')).includes('已修改'));
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
