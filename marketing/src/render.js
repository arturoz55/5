// Renders marketing images and the promo video from cards.html.
//   node marketing/src/render.js     (needs Chromium via Playwright; ffmpeg via imageio-ffmpeg for mp4)
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const SRC = "file://" + path.join(__dirname, "cards.html");
const OUT = path.join(__dirname, "..");
const SIZES = { avatar: [400, 400], header: [1500, 500], launch: [1200, 675], how: [1200, 675], lock: [1080, 1080], alpha: [1200, 675] };

(async () => {
  const browser = await chromium.launch();
  for (const [card, [w, h]] of Object.entries(SIZES)) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await page.goto(`${SRC}?card=${card}`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, "images", `tensorforge-${card}.png`) });
    await page.close();
    console.log("image", card);
  }
  const dir = path.join(OUT, "video", "raw");
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.goto(`${SRC}?card=video`);
  await page.waitForFunction(() => window.__done, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const raw = await page.video().path();
  await ctx.close();
  await browser.close();
  let ffmpeg = process.env.FFMPEG;
  if (!ffmpeg) { try { ffmpeg = execFileSync("python3", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim(); } catch { /* none */ } }
  const mp4 = path.join(OUT, "video", "tensorforge-launch.mp4");
  if (ffmpeg) {
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-ss", "0.3", "-i", raw, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", "-r", "30", mp4]);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("video", mp4);
  } else console.log("video (webm, no ffmpeg found)", raw);
})().catch((e) => { console.error(e); process.exit(1); });
