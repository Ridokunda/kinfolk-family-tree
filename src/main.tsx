import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}>{state={error:''};static getDerivedStateFromError(e:Error){return {error:e.message};}render(){return this.state.error?<div className="boot"><h1>We couldn’t open the archive.</h1><p>{this.state.error}</p><p>Do not clear browser storage. Try reopening the app, and keep any existing backup files safe.</p><button className="button" onClick={()=>location.reload()}>Try again</button></div>:this.props.children;}}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App/></ErrorBoundary></React.StrictMode>);
