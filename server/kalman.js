'use strict';

/**
 * 1D Kalman Filter for GPS coordinate smoothing.
 * Applied independently to latitude and longitude.
 *
 * State:   [position, velocity]
 * Measurement: position (from GPS)
 *
 * This removes GPS jitter while preserving real movement.
 */
class KalmanFilter1D {
  constructor({ processNoise = 0.01, measurementNoise = 3.0, estimatedError = 1.0 } = {}) {
    this.Q = processNoise;        // Process noise covariance
    this.R = measurementNoise;     // Measurement noise covariance
    this.P = estimatedError;       // Estimation error covariance
    this.x = null;                 // Current state estimate
    this.K = 0;                    // Kalman gain
    this.initialized = false;
  }

  filter(measurement) {
    if (!this.initialized) {
      this.x = measurement;
      this.initialized = true;
      return measurement;
    }

    // Prediction
    this.P = this.P + this.Q;

    // Update
    this.K = this.P / (this.P + this.R);
    this.x = this.x + this.K * (measurement - this.x);
    this.P = (1 - this.K) * this.P;

    return this.x;
  }

  reset() {
    this.x = null;
    this.initialized = false;
  }
}

/**
 * 2D GPS Kalman Filter (lat/lng pair).
 * Adjusts noise based on reported GPS accuracy.
 */
class GPSKalmanFilter {
  constructor() {
    this.latFilter = new KalmanFilter1D({ processNoise: 0.00001, measurementNoise: 0.0001 });
    this.lngFilter = new KalmanFilter1D({ processNoise: 0.00001, measurementNoise: 0.0001 });
    this.lastTime = null;
    this.lastLat = null;
    this.lastLng = null;
  }

  /**
   * @param {Object} point - { lat, lng, accuracy, speed, timestamp }
   * @returns {Object} - { lat, lng, speed, isOutlier }
   */
  filter(point) {
    const { lat, lng, accuracy = 10, timestamp } = point;

    // Adjust measurement noise based on GPS accuracy
    // Higher accuracy (lower meters) → trust measurement more
    const noise = Math.max(0.00001, accuracy * 0.00001);
    this.latFilter.R = noise;
    this.lngFilter.R = noise;

    // Outlier detection: if jump > 500m in < 2s, likely GPS glitch
    let isOutlier = false;
    if (this.lastLat !== null && this.lastTime !== null) {
      const dt = (timestamp - this.lastTime) / 1000; // seconds
      const dist = haversineDistance(this.lastLat, this.lastLng, lat, lng);
      const impliedSpeed = dt > 0 ? dist / dt : 0;

      // > 200 km/h is impossible for healthcare staff
      if (impliedSpeed > 55.6 && dt < 5) {
        isOutlier = true;
        // Don't update filter with outlier
        return {
          lat: this.lastLat,
          lng: this.lastLng,
          speed: 0,
          isOutlier: true,
        };
      }
    }

    const filteredLat = this.latFilter.filter(lat);
    const filteredLng = this.lngFilter.filter(lng);

    // Compute smoothed speed
    let speed = point.speed || 0;
    if (this.lastLat !== null && this.lastTime !== null) {
      const dt = (timestamp - this.lastTime) / 1000;
      if (dt > 0) {
        const dist = haversineDistance(this.lastLat, this.lastLng, filteredLat, filteredLng);
        speed = dist / dt;
      }
    }

    this.lastLat = filteredLat;
    this.lastLng = filteredLng;
    this.lastTime = timestamp;

    return { lat: filteredLat, lng: filteredLng, speed, isOutlier: false };
  }

  reset() {
    this.latFilter.reset();
    this.lngFilter.reset();
    this.lastTime = null;
    this.lastLat = null;
    this.lastLng = null;
  }
}

/**
 * Haversine distance in meters between two lat/lng points.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

module.exports = { KalmanFilter1D, GPSKalmanFilter, haversineDistance };
