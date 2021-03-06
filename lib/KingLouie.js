const fs = require('fs');
const expect = require('chai').expect;

const RandomClick = require('./adapter/actions/RandomClick');
const ILabels = require('./adapter/ILabels');
const Labels = require('./adapter/Labels');
const Actions = require('./adapter/Actions');
const Screenshot = require('./adapter/Screenshot');

const Trace = require('./model/Trace');
const ModelBuilder = require('./model/ModelBuilder');
const Visualizer = require('./model/Visualizer');
const InstantiatedLabel = require('./model/InstantiatedLabel');

class KingLouie {
    get traces() { return this._traces; }
    get driver() { return this._driver; }

    constructor(driver, app, traces = []) {
        expect(driver).to.respondTo('get',  'driver must be a WebDriver');
        expect(driver).to.respondTo('quit', 'driver must be a WebDriver');

        expect(app).to.respondTo('preamble',       'app not correctly implemented');
        expect(app).to.respondTo('waitForOutput',  'app not correctly implemented');
        expect(app).to.respondTo('determineState', 'app not correctly implemented');

        this._driver = driver;
        this._app = app;

        this._traces = traces;
    }

    loadTraces(dir = './output/traces/') {
        var traces = this._traces;
        var filenames = fs.readdirSync(dir);

        filenames.forEach(function(filename) {
            if (filename.endsWith('.json')) {
                var trace = Trace.fromFile(dir + filename);
                // annotate
                trace.fromFile = true;
                traces.push(trace);
            }
        });
    }

    visualize(location) {
        var model = new ModelBuilder(this.traces, Labels).build();
        Visualizer.createHTML(model, location);
    }

    async rerun(statename) {
        var model = new ModelBuilder(this.traces, Labels).build();
        var path = model.findPath(model.findState(statename));

        for (var i = 0; i < path.length; i++) {
            var transition = path[i];
            var ilabel = InstantiatedLabel.fromTransition(transition);
            if (ilabel.label.response || ilabel.label.quiescence) {
                continue;
            }
            var action = Actions.fromILabel(this.driver, this._app, ilabel);
            await action.execute();
        }

        // TODO: observe state and output
        // TODO: log the new trace
        // TODO: re-evaluate path after each step
    }

    // TODO: remove, no need to expose transitions, use rerun instead.
    findPath(statename) {
        var model = new ModelBuilder(this.traces, Labels).build();
        return model.findPath(model.findState(statename));
    }

    saveTraces() {
        for (var i = 0; i < this._traces.length; i++) {
            var trace = this._traces[i];
            // Don't save traces we've loaded via `loadTraces`
            if (!trace.fromFile) {
                trace.toFile(`output/traces/trace-${Date.now()}.json`);
            }
        }
    }

    async stimulate(saveImages, decorateElements) {
        try {
            var click = new RandomClick(this._driver, {screenshot: saveImages, decorate: decorateElements});
            // TODO: clicker should return ilabel/trace
            return ILabels.click(await click.execute());
        } catch (e) {
            return ILabels.stimulusError(e.message);
        }
    }

    async checkOutput() {
        var output = await this._app.waitForOutput(this._driver);
        if (output.length === 0) {
            output.add(ILabels.quiescence());
        }
        return output;
    }

    async swing(config) {
        const defaultConfig = {
            maxTraces: 1,
            maxDepth: 10,
            // Save images of state and things we interact with
            saveImages: false,
            // Decorate elements we (try to) interact with
            decorateElements: false
        };
        config = Object.assign({}, defaultConfig, config);

        for (var i = 0; i < config.maxTraces; i++) {
            var trace = new Trace();

            console.log(`TRACE ${i + 1}/${config.maxTraces} STARTED`);

            for (var j = 0; j < config.maxDepth; j++) {
                if (j === 0) {
                    trace.addAll(await this._app.preamble(this._driver));
                } else {
                    trace.add(await this.stimulate(config.saveImages, config.decorateElements));
                }
                trace.addAll(await this.checkOutput());
                const meta = {};
                meta.state = await this._app.determineState(this._driver);
                if (config.saveImages) {
                    meta.stateImage = (await Screenshot.fromPage(this._driver)).toBase64();
                }
                trace[trace.length - 1].updateMetadata(meta);
            }

            console.log(trace.map(function(_ilabel) { return _ilabel.label.name; }));

            this._traces.push(trace);
        }
    }
}

module.exports = KingLouie;
