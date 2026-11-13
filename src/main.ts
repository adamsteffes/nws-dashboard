import { render } from "lit-html";
import "./styles/base.css";
import { homeView } from "./views/home";

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("#app element not found");
}
render(homeView(__APP_VERSION__), app);
