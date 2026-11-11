"""Assembles the demo video from a recording made by e2e/demo.mjs: title card, walkthrough, the PayPal approval popup
spliced in where it happened, end card. Captions are already in the recording. No audio except a silent track.
Usage: python3 scripts/assemble_video.py <recording dir> <out.mp4>"""
import json, subprocess, sys
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1], sys.argv[2]
m = json.load(open(f"{d}/marks.json")); M = m["marks"]
font = lambda s, b=False: ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if b else ''}.ttf", s)
def card(path, title, lines):
    im = Image.new("RGB", (1920, 1080), "#f6f3ea"); dr = ImageDraw.Draw(im)
    dr.rectangle((0, 0, 1920, 14), fill="#f2b632"); dr.text((140, 250), title, font=font(110, True), fill="#17231c"); y = 440
    for t, sz, col in lines: dr.text((140, y), t, font=font(sz), fill=col); y += int(sz * 1.6)
    im.save(path)
card(f"{d}/title.png", "SwapSafe", [("Out-of-stock grocery swaps the shopper agrees to.", 52, "#17231c"), ("PayPal holds the basket and captures only what was packed.", 52, "#17231c"), ("", 30, "#17231c"),
     ("Recorded on the live demo, against the PayPal sandbox.", 38, "#55615a"), ("Every payment in this video is a real sandbox transaction.", 38, "#55615a")])
card(f"{d}/end.png", "SwapSafe", [("PayPal: Orders v2 and Payments v2 (authorize, final capture, void, refund),", 40, "#17231c"), ("JS SDK v6, Agent Toolkit, verified webhooks", 40, "#17231c"),
     ("AI: Gemini 3.5 Flash-Lite through the Vercel AI SDK. It reads labels; it never sets an amount.", 40, "#17231c"), ("Next.js on Vercel, Neon Postgres", 40, "#17231c"), ("", 30, "#17231c"),
     ("swapsafe.vercel.app      github.com/rwe6445/swapsafe", 44, "#1f5a3d")])
a, b, end = M["popup_open"], M["popup_close"], M["end"] + 0.5
v = "scale=1920:1080:flags=lanczos,fps=30,format=yuv420p,setsar=1"
fc = (f"[0:v]{v}[t];[1:v]trim=start={M['start']}:end={a},setpts=PTS-STARTPTS,{v}[m1];[2:v]setpts=PTS-STARTPTS,{v}[p];"
      f"[1:v]trim=start={b}:end={end},setpts=PTS-STARTPTS,{v}[m2];[3:v]{v}[e];[t][m1][p][m2][e]concat=n=5:v=1:a=0[v]")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-t", "5", "-i", f"{d}/title.png", "-i", m["main"], "-i", m["popup"], "-loop", "1", "-t", "7", "-i", f"{d}/end.png",
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-filter_complex", fc, "-map", "[v]", "-map", "4:a", "-shortest",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out], check=True)
print("wrote", out)
