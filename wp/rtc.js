// Bellen in EdgeHTML: adapter.js (7.x, de laatste met Edge-ondersteuning) maakt van ORTC een RTCPeerConnection.
// app.js gebruikt transceivers en sender-parameters; die kent die laag niet, dus die worden hier nagebootst.
import 'webrtc-adapter';

const PC = window.RTCPeerConnection;
if (PC && !PC.prototype.addTransceiver) {
  PC.prototype.addTransceiver = function (spoorOfSoort, init) {
    init = init || {};
    const pc = this, lijst = (pc._wpTx = pc._wpTx || []);
    const stream = (init.streams && init.streams[0]) || (pc._wpStream = pc._wpStream || new MediaStream());
    const soort = typeof spoorOfSoort === 'string' ? spoorOfSoort : spoorOfSoort.kind;
    const tx = { mid: null, direction: init.direction || 'sendrecv', receiver: { track: null }, stopped: false, stop() {} };
    let echte = typeof spoorOfSoort === 'string' ? null : pc.addTrack(spoorOfSoort, stream);
    tx.sender = {
      get track() { return echte ? echte.track : null; },
      async replaceTrack(t) {
        if (echte && echte.replaceTrack) return echte.replaceTrack(t);
        if (t && !echte) echte = pc.addTrack(t, stream); // geen spoor vooraf: alsnog toevoegen (nieuwe onderhandeling)
      },
      getParameters() { return { encodings: [{}] }; },
      setParameters() { return Promise.resolve(); },
    };
    if (soort === 'video') pc._wpVideo = true;
    lijst.push(tx);
    return tx;
  };
  PC.prototype.getTransceivers = function () { return this._wpTx || []; };
  // ook zonder eigen camera video van de ander ontvangen
  const offer = PC.prototype.createOffer;
  PC.prototype.createOffer = function (o) { return offer.call(this, Object.assign({ offerToReceiveAudio: true, offerToReceiveVideo: !!this._wpVideo }, o || {})); };
}
const S = window.RTCRtpSender;
if (S && !S.prototype.getParameters) {
  S.prototype.getParameters = function () { return { encodings: [{}] }; };
  S.prototype.setParameters = function () { return Promise.resolve(); };
}
if (PC && !PC.prototype.getSenders) PC.prototype.getSenders = function () { return []; };
