var DocumentWorker = require('@scipe/workers').DocumentWorker;

var w = new DocumentWorker({
  curiePrefix: 'scienceai',
  nWorkers: 1,
  log: {
    name: 'document-worker',
    level: 'fatal'
  }
});
w.listen();
