import { App } from 'cdktn';
import { FixtureStack, fixtureOptions } from './stack';
const app = new App();
new FixtureStack(app, fixtureOptions());
app.synth();
