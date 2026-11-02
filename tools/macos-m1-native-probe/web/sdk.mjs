// Build-time byte/SRI verification is mandatory; this is the runtime API/version gate.
export function verifiedSdk(value) {
  if (
    value?.version !== "2.17.2" ||
    typeof value.Room !== "function" ||
    typeof value.createLocalAudioTrack !== "function" ||
    typeof value.setLogLevel !== "function" ||
    !value.RoomEvent
  )
    throw new Error("SDK_UNAVAILABLE");
  for (const key of [
    "Disconnected",
    "Reconnecting",
    "SignalReconnecting",
    "TrackSubscribed",
    "TrackUnsubscribed",
    "AudioPlaybackStatusChanged",
  ])
    if (typeof value.RoomEvent[key] !== "string") throw new Error("SDK_UNAVAILABLE");
  return value;
}
