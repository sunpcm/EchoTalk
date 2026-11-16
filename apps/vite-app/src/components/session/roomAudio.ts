export interface TrackHolderRoom {
  localParticipant?: {
    trackPublications?: Map<unknown, { track?: { stop?: () => void } }>;
  };
}

/** 同步停止指定 Room 拥有的全部本地音轨（不等待网络 disconnect） */
export function stopRoomLocalTracks(room?: TrackHolderRoom | null): void {
  if (!room?.localParticipant?.trackPublications) return;
  try {
    room.localParticipant.trackPublications.forEach((pub) => {
      try {
        pub?.track?.stop?.();
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}
