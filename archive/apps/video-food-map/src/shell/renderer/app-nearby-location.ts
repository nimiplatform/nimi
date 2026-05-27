import type { Dispatch, SetStateAction } from 'react';

import type { NearbyLocationState } from './app-shell-sections.js';

export function requestNearbyLocation(
  setNearbyLocationState: Dispatch<SetStateAction<NearbyLocationState>>,
) {
  if (!window.navigator.geolocation) {
    setNearbyLocationState({
      status: 'unsupported',
      location: null,
      message: '这台设备现在拿不到定位能力。',
    });
    return;
  }

  setNearbyLocationState({
    status: 'locating',
    location: null,
    message: '',
  });

  window.navigator.geolocation.getCurrentPosition(
    (position) => {
      setNearbyLocationState({
        status: 'ready',
        location: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          capturedAt: Date.now(),
        },
        message: '',
      });
    },
    (error) => {
      const message = error.code === error.PERMISSION_DENIED
        ? '定位权限现在是关着的。去系统设置里的定位服务把它重新打开后，再回来重试。'
        : error.code === error.POSITION_UNAVAILABLE
          ? '这次没拿到可用定位，附近地图先继续按普通地图显示。'
          : '定位超时了，你可以再试一次。';
      setNearbyLocationState({
        status: error.code === error.PERMISSION_DENIED ? 'denied' : 'failed',
        location: null,
        message,
      });
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    },
  );
}
