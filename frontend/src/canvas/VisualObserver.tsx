import { useEffect } from 'react';
import { runtimeWebSocketUrl } from '../api/client';
import { captureObservation, type ObservationRequest } from './visualObservation';

export function VisualObserver() {
  useEffect(() => {
    let active = true;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let work = Promise.resolve();
    const connect = () => {
      const url = new URL(runtimeWebSocketUrl());
      url.pathname = url.pathname.replace(/\/events$/, '/visual');
      const current = socket = new WebSocket(url);
      current.onmessage = event => {
        const request = JSON.parse(event.data) as ObservationRequest;
        work = work.then(async () => {
          if (!active || current.readyState !== WebSocket.OPEN) return;
          let response;
          try { response = await captureObservation(request); }
          catch { response = { request_id: request.request_id, error: 'Unable to capture this canvas. Keep OAW open and retry.' }; }
          if (active && current.readyState === WebSocket.OPEN) current.send(JSON.stringify(response));
        });
      };
      current.onclose = () => { if (active) timer = setTimeout(connect, 3000); };
      current.onerror = () => current.close();
    };
    connect();
    return () => { active = false; clearTimeout(timer); socket?.close(); };
  }, []);
  return null;
}
