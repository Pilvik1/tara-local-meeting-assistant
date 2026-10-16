export type InputMode = 'microphone' | 'system' | 'both'

export type AudioInputDevice = {
  deviceId: string
  label: string
}

export type AudioCaptureSession = {
  recordingStream: MediaStream
  sourceStreams: Partial<Record<'microphone' | 'system' | 'mixed', MediaStream>>
  getLevels: () => { microphone: number; system: number; mixed: number }
  close: () => void
}

export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  let unnamedIndex = 0
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device) => {
      unnamedIndex += 1
      return {
        deviceId: device.deviceId,
        label: device.label || `Microphone ${unnamedIndex}`,
      }
    })
}

function stopStreams(streams: MediaStream[]) {
  streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()))
}

export async function createAudioCaptureSession(
  mode: InputMode,
  microphoneDeviceId = '',
): Promise<AudioCaptureSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Audio capture is unavailable in this environment. Use the Tara desktop app.')
  }

  const sourceStreams: MediaStream[] = []
  let audioContext: AudioContext | null = null

  try {
    let systemStream: MediaStream | null = null
    let microphoneStream: MediaStream | null = null

    // Request display capture first so the Windows system picker remains tied to
    // the original click. The microphone prompt follows only after a source is chosen.
    if (mode === 'system' || mode === 'both') {
      if (!navigator.mediaDevices.getDisplayMedia) {
        throw new Error('System audio capture is unavailable. Use the Tara desktop app on Windows.')
      }
      systemStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      sourceStreams.push(systemStream)
      if (!systemStream.getAudioTracks().length) {
        throw new Error('The selected screen did not include audio. Enable “Share system audio” and try again.')
      }
    }

    if (mode === 'microphone' || mode === 'both') {
      const audio: boolean | MediaTrackConstraints = microphoneDeviceId
        ? {
            deviceId: { exact: microphoneDeviceId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio })
      sourceStreams.push(microphoneStream)
      if (!microphoneStream.getAudioTracks().length) {
        throw new Error('The selected microphone did not provide an audio track.')
      }
    }

    audioContext = new AudioContext()
    const destination = audioContext.createMediaStreamDestination()
    const compressor = audioContext.createDynamicsCompressor()
    compressor.threshold.value = -6
    compressor.knee.value = 12
    compressor.ratio.value = 4
    compressor.attack.value = 0.003
    compressor.release.value = 0.25
    compressor.connect(destination)

    const analysers: Partial<Record<'microphone' | 'system' | 'mixed', AnalyserNode>> = {}

    function connectSource(stream: MediaStream, sourceName: 'microphone' | 'system') {
      const source = audioContext!.createMediaStreamSource(stream)
      const analyser = audioContext!.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.72
      analysers[sourceName] = analyser
      const gain = audioContext!.createGain()
      gain.gain.value = mode === 'both' ? 0.82 : 1
      source.connect(analyser).connect(gain).connect(compressor)
    }

    if (microphoneStream) connectSource(microphoneStream, 'microphone')
    if (systemStream) connectSource(systemStream, 'system')

    const mixedAnalyser = audioContext.createAnalyser()
    mixedAnalyser.fftSize = 512
    mixedAnalyser.smoothingTimeConstant = 0.72
    compressor.disconnect()
    compressor.connect(mixedAnalyser).connect(destination)
    analysers.mixed = mixedAnalyser

    await audioContext.resume()
    const recordingStream = destination.stream

    const audioStreams: Partial<Record<'microphone' | 'system' | 'mixed', MediaStream>> = {
      mixed: recordingStream,
    }
    if (microphoneStream) audioStreams.microphone = new MediaStream(microphoneStream.getAudioTracks())
    if (systemStream) audioStreams.system = new MediaStream(systemStream.getAudioTracks())

    function levelFor(analyser?: AnalyserNode) {
      if (!analyser) return 0
      const samples = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) {
        const normalized = (sample - 128) / 128
        sum += normalized * normalized
      }
      return Math.min(1, Math.sqrt(sum / samples.length) * 3.2)
    }

    return {
      recordingStream,
      sourceStreams: audioStreams,
      getLevels: () => ({
        microphone: levelFor(analysers.microphone),
        system: levelFor(analysers.system),
        mixed: levelFor(analysers.mixed),
      }),
      close: () => {
        stopStreams(sourceStreams)
        recordingStream.getTracks().forEach((track) => track.stop())
        void audioContext?.close()
      },
    }
  } catch (error) {
    stopStreams(sourceStreams)
    if (audioContext) void audioContext.close()
    throw error
  }
}
