import {analyzePCM} from './analysis-core.js';
self.onmessage = ({data}) => {
  try {
    const result = analyzePCM(data.channels, data.sampleRate, progress=>self.postMessage({progress}));
    self.postMessage({result}, ['low','mid','high','peak'].map(k=>result[k].buffer));
  } catch(error) { self.postMessage({error:error.message}); }
};
