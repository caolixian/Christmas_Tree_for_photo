import React from "react";
import "./index.css";

export default function App() {
  return (
    <div
      className="app-root"
    >
      {/* 雪花背景 */}
      <div className="snow" />

      {/* 圣诞树 */}
      <div className="tree-container">
        <div className="star" />
        <div className="tree">
          <div className="layer layer1" />
          <div className="layer layer2" />
          <div className="layer layer3" />
        </div>
        <div className="trunk" />

        {/* 灯光 */}
        <div className="lights">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
