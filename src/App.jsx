import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { AgentVideoComponent } from './components/avatar'

// import FrontDesk from './components/frontdesk/frontDesk'

const App = () => {
  return (
    <Router>
      <Routes>
       
        <Route path="/" element={<AgentVideoComponent />} />
  
      </Routes>
    </Router>
  );
};

export default App;

