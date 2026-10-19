import React, { useEffect, useRef } from 'react';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { LatLng } from '../../types/navigation';

interface RoutePolylineProps {
  path: LatLng[];
  isStale?: boolean;
  requestId?: string;
}

export const RoutePolyline: React.FC<RoutePolylineProps> = ({ path, isStale = false, requestId = '' }) => {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const coreLib = useMapsLibrary('core');
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const lastFittedRequestIdRef = useRef<string>('');

  useEffect(() => {
    if (!map) return;
    if (typeof google === 'undefined' || !google.maps || !google.maps.Polyline) return;

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    if (!path || path.length === 0) return;

    try {
      // Primary route line
      const polyline = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: isStale ? '#94a3b8' : '#2563eb',
        strokeOpacity: isStale ? 0.6 : 0.9,
        strokeWeight: 6,
        map,
      });

      polylineRef.current = polyline;

      // Fit bounds ONLY when the route has actually changed (new requestId)
      // This prevents overriding the driver's manual pan or zoom on incidental re-renders!
      if (google.maps.LatLngBounds && requestId && requestId !== lastFittedRequestIdRef.current) {
        lastFittedRequestIdRef.current = requestId;
        const bounds = new google.maps.LatLngBounds();
        path.forEach((pt) => bounds.extend(pt));

        const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
        map.fitBounds(bounds, {
          top: isMobile ? 70 : 80,
          right: isMobile ? 25 : 50,
          bottom: isMobile ? 240 : 200,
          left: isMobile ? 25 : 50,
        });
      }
    } catch (e) {
      console.warn('Polyline render safe caught:', e);
    }

    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
    };
  }, [map, mapsLib, coreLib, path, isStale, requestId]);

  return null;
};
