import { render } from 'preact';
import { App } from './ui/App';
import './ui/styles/base.css';
import './ui/styles/reader.css';
import './ui/styles/mobile.css';

render(<App />, document.getElementById('app')!);
