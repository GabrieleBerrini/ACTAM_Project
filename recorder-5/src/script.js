// Stato base
let mediaRecorder, recordedChunks = [], audioBlob = null, audioUrl = null;
let audioCtx, lowpassFilter, highpassFilter, delayNode, delayFeedback,
    reverbConvolver, dryGain, wetGain, masterGain, analyser, dataArray,
    animationId;
let mediaElementSource = null;

// UI
const btnStartRec = document.getElementById("btnStartRec");
const btnStopRec = document.getElementById("btnStopRec");
const btnPlayProcessed = document.getElementById("btnPlayProcessed");
const btnDownloadWav = document.getElementById("btnDownloadWav");
const btnDownloadProcessedWav = document.getElementById("btnDownloadProcessedWav");
const statusEl = document.getElementById("status");
const player = document.getElementById("player");

const gainSlider = document.getElementById("gain");
const pitchSlider = document.getElementById("pitch");
const lowpassSlider = document.getElementById("lowpass");
const highpassSlider = document.getElementById("highpass");
const delayTimeSlider = document.getElementById("delayTime");
const reverbMixSlider = document.getElementById("reverbMix");

const waveformCanvas = document.getElementById("waveform");
const wfCtx = waveformCanvas.getContext("2d");

// Init grafo Web Audio
function initAudioGraph() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  lowpassFilter = audioCtx.createBiquadFilter();
  lowpassFilter.type = "lowpass";
  lowpassFilter.frequency.value = 20000;

  highpassFilter = audioCtx.createBiquadFilter();
  highpassFilter.type = "highpass";
  highpassFilter.frequency.value = 10;

  delayNode = audioCtx.createDelay(5.0);
  delayNode.delayTime.value = 0.0;
  delayFeedback = audioCtx.createGain();
  delayFeedback.gain.value = 0.3;
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);

  reverbConvolver = audioCtx.createConvolver();
  reverbConvolver.buffer = createReverbImpulse(audioCtx, 2.5, 2.0);

  dryGain = audioCtx.createGain();
  wetGain = audioCtx.createGain();
  masterGain = audioCtx.createGain();
  dryGain.gain.value = 0.7;
  wetGain.gain.value = 0.3;
  masterGain.gain.value = 1.0;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.fftSize);

  lowpassFilter.connect(highpassFilter);
  highpassFilter.connect(delayNode);
  delayNode.connect(dryGain);
  delayNode.connect(reverbConvolver);
  reverbConvolver.connect(wetGain);
  dryGain.connect(masterGain);
  wetGain.connect(masterGain);
  masterGain.connect(analyser);
  analyser.connect(audioCtx.destination);
}

// collega il player all'analyser per waveform sul play grezzo
function connectPlayerToAnalyser() {
  if (!audioCtx || !player) return;
  if (mediaElementSource) return;
  mediaElementSource = audioCtx.createMediaElementSource(player);
  mediaElementSource.connect(analyser);
}

// impulso riverbero
function createReverbImpulse(context, duration, decay) {
  const rate = context.sampleRate;
  const length = rate * duration;
  const impulse = context.createBuffer(2, length, rate);
  for (let c = 0; c < impulse.numberOfChannels; c++) {
    const chData = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const n = (length - i) / length;
      chData[i] = (Math.random() * 2 - 1) * Math.pow(n, decay);
    }
  }
  return impulse;
}

// Waveform
function drawWaveform() {
  if (!analyser) return;
  animationId = requestAnimationFrame(drawWaveform);
  analyser.getByteTimeDomainData(dataArray);
  const w = waveformCanvas.width, h = waveformCanvas.height;
  wfCtx.fillStyle = "#000"; wfCtx.fillRect(0,0,w,h);
  wfCtx.lineWidth = 2; wfCtx.strokeStyle = "#38bdf8";
  wfCtx.beginPath();
  const slice = w / dataArray.length;
  let x = 0;
  for (let i=0;i<dataArray.length;i++) {
    const v = dataArray[i] / 128.0;
    const y = v * h / 2;
    i === 0 ? wfCtx.moveTo(x,y) : wfCtx.lineTo(x,y);
    x += slice;
  }
  wfCtx.lineTo(w,h/2); wfCtx.stroke();
}

// waveform anche per player grezzo
player.addEventListener("play", () => {
  initAudioGraph();
  connectPlayerToAnalyser();
  if (!animationId) drawWaveform();
});
player.addEventListener("ended", () => {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
});

// Registrazione microfono
btnStartRec.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    recordedChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      audioBlob = new Blob(recordedChunks, { type: "audio/webm" });
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(audioBlob);
      player.src = audioUrl;
      btnPlayProcessed.disabled = false;
      btnDownloadWav.disabled = false;
      btnDownloadProcessedWav.disabled = false;
      statusEl.textContent = "Registrazione pronta";
    };
    mediaRecorder.start();
    btnStartRec.disabled = true;
    btnStopRec.disabled = false;
    statusEl.textContent = "Registrazione in corso...";
  } catch(e) {
    console.error(e);
    statusEl.textContent = "Errore accesso microfono";
  }
});

btnStopRec.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  btnStartRec.disabled = false;
  btnStopRec.disabled = true;
});

// Download WAV grezzo (AudioBuffer → WAV, durata corretta) [web:6][web:96]
btnDownloadWav.addEventListener("click", async () => {
  if (!audioBlob) return;
  initAudioGraph();
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const wavBuffer = audioBufferToWav(audioBuffer);
  const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });
  downloadBlob(wavBlob, "registrazione.wav");
});

// Play con effetti live
btnPlayProcessed.addEventListener("click", async () => {
  if (!audioBlob) return;
  initAudioGraph();
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = parseFloat(pitchSlider.value);
  source.connect(lowpassFilter);
  source.start();
  if (!animationId) drawWaveform();
});

// Download WAV con effetti (OfflineAudioContext singolo, dimensionato sulla durata reale) [web:110][web:119]
btnDownloadProcessedWav.addEventListener("click", async () => {
  if (!audioBlob) return;

  const arr = await audioBlob.arrayBuffer();

  // Prima decodifica per ottenere durata e sampleRate reali
  const probeCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await probeCtx.decodeAudioData(arr);
  const duration = decoded.duration;
  const sampleRate = decoded.sampleRate;
  probeCtx.close();

  const length = Math.ceil(duration * sampleRate);
  const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, length, sampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;

  const lp = offlineCtx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = parseFloat(lowpassSlider.value);
  const hp = offlineCtx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = parseFloat(highpassSlider.value);
  const del = offlineCtx.createDelay(5.0); del.delayTime.value = parseFloat(delayTimeSlider.value);
  const fb = offlineCtx.createGain(); fb.gain.value = 0.3; del.connect(fb); fb.connect(del);

  const conv = offlineCtx.createConvolver();
  conv.buffer = createReverbImpulse(offlineCtx, 2.5, 2.0);

  const dry = offlineCtx.createGain();
  const wet = offlineCtx.createGain();
  const master = offlineCtx.createGain();

  master.gain.value = parseFloat(gainSlider.value);
  const mix = parseFloat(reverbMixSlider.value);
  dry.gain.value = 1 - mix;
  wet.gain.value = mix;

  source.playbackRate.value = parseFloat(pitchSlider.value);

  source.connect(lp);
  lp.connect(hp);
  hp.connect(del);
  del.connect(dry);
  del.connect(conv);
  conv.connect(wet);
  dry.connect(master);
  wet.connect(master);
  master.connect(offlineCtx.destination);

  source.start(0);
  const rendered = await offlineCtx.startRendering();
  const wavBuffer = audioBufferToWav(rendered);
  const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });
  downloadBlob(wavBlob, "registrazione_effetti.wav");
  statusEl.textContent = "WAV con effetti pronto";
});

// util scarica Blob
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Parametri
function updateParam(id, v) {
  if (id === "gain" && masterGain) masterGain.gain.value = v;
  else if (id === "lowpass" && lowpassFilter) lowpassFilter.frequency.value = v;
  else if (id === "highpass" && highpassFilter) highpassFilter.frequency.value = v;
  else if (id === "delayTime" && delayNode) delayNode.delayTime.value = v;
  else if (id === "reverbMix" && dryGain && wetGain) { wetGain.gain.value = v; dryGain.gain.value = 1 - v; }
}

function updateValLabel(id, v) {
  const el = document.getElementById(id + "Val");
  if (!el) return;
  if (id === "lowpass" || id === "highpass") el.textContent = Math.round(v);
  else el.textContent = v.toFixed(2);
}

gainSlider.addEventListener("input", () => { const v = +gainSlider.value; updateParam("gain", v); updateValLabel("gain", v); });
pitchSlider.addEventListener("input", () => { const v = +pitchSlider.value; updateValLabel("pitch", v); });
lowpassSlider.addEventListener("input", () => { const v = +lowpassSlider.value; updateParam("lowpass", v); updateValLabel("lowpass", v); });
highpassSlider.addEventListener("input", () => { const v = +highpassSlider.value; updateParam("highpass", v); updateValLabel("highpass", v); });
delayTimeSlider.addEventListener("input", () => { const v = +delayTimeSlider.value; updateParam("delayTime", v); updateValLabel("delayTime", v); });
reverbMixSlider.addEventListener("input", () => { const v = +reverbMixSlider.value; updateParam("reverbMix", v); updateValLabel("reverbMix", v); });

// Knobs
const knobElems = document.querySelectorAll(".knob");
const lerp = (a,b,t)=>a+(b-a)*t;
const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));
const valueToAngle = (v,min,max)=>-135+((v-min)/(max-min))*270;

knobElems.forEach(knob => {
  const id = knob.dataset.target;
  const slider = document.getElementById(id);
  const min = +knob.dataset.min, max = +knob.dataset.max, step = +knob.dataset.step || 0.01;
  let value = +slider.value, angle = valueToAngle(value,min,max);
  let dragging = false, startY, startAngle;
  knob.style.transform = `rotate(${angle}deg)`;

  knob.addEventListener("mousedown", e => {
    dragging = true; startY = e.clientY; startAngle = angle;
    document.body.style.userSelect = "none";
  });
  window.addEventListener("mouseup", () => { dragging = false; document.body.style.userSelect = ""; });
  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    angle = clamp(startAngle + dy * 0.7, -135, 135);
    knob.style.transform = `rotate(${angle}deg)`;
    const t = (angle + 135) / 270;
    const raw = lerp(min,max,t);
    const v = Math.round(raw / step) * step;
    slider.value = v;
    updateParam(id, v);
    updateValLabel(id, v);
  });

  updateValLabel(id, value);
  updateParam(id, value);
});

// Preset
document.querySelectorAll(".preset").forEach(btn => {
  btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
});

function applyPreset(name) {
  initAudioGraph();
  const set = (id,val)=>{ const s=document.getElementById(id); s.value=val; updateParam(id,val); updateValLabel(id,val); const k=document.querySelector(`.knob[data-target="${id}"]`); if(k){const min=+k.dataset.min,max=+k.dataset.max; k.style.transform=`rotate(${valueToAngle(val,min,max)}deg)`;} };
  if (name==="clean"){ set("gain",1); set("lowpass",20000); set("highpass",10); set("delayTime",0); set("reverbMix",0.1); pitchSlider.value=1; updateValLabel("pitch",1);}
  if (name==="phone"){ set("gain",1); set("lowpass",3500); set("highpass",400); set("delayTime",0); set("reverbMix",0.0); pitchSlider.value=1; updateValLabel("pitch",1);}
  if (name==="hall"){ set("gain",1); set("lowpass",18000); set("highpass",80); set("delayTime",0.25); set("reverbMix",0.7); pitchSlider.value=1; updateValLabel("pitch",1);}
  if (name==="lofi"){ set("gain",0.9); set("lowpass",5000); set("highpass",150); set("delayTime",0.12); set("reverbMix",0.4); pitchSlider.value=0.9; updateValLabel("pitch",0.9);}
}

// Stop animazione
window.addEventListener("beforeunload", () => { if (animationId) cancelAnimationFrame(animationId); });