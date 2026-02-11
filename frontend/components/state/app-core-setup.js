import ImageFilterPanel from '../shared/state/image-filter-panel.js';
import { CurateHomeStateController } from './curate-home-state.js';
import { CurateAuditStateController } from './curate-audit-state.js';
import { CurateExploreStateController } from './curate-explore-state.js';
import { RatingModalStateController } from './rating-modal-state.js';
import { SearchStateController } from './search-state.js';
import { AppShellStateController } from './app-shell-state.js';
import { AppDataStateController } from './app-data-state.js';
import { AppEventsStateController } from './app-events-state.js';

export function initializeAppCoreSetup(host) {
  host.searchFilterPanel = new ImageFilterPanel('search');
  host.searchFilterPanel.setTenant(host.tenant);

  host.curateHomeFilterPanel = new ImageFilterPanel('curate-home');
  host.curateHomeFilterPanel.setTenant(host.tenant);

  host.curateAuditFilterPanel = new ImageFilterPanel('curate-audit');
  host.curateAuditFilterPanel.setTenant(host.tenant);

  host._curateHomeState = new CurateHomeStateController(host);
  host._curateAuditState = new CurateAuditStateController(host);
  host._curateExploreState = new CurateExploreStateController(host);
  host._searchState = new SearchStateController(host);
  host._ratingModalState = new RatingModalStateController(host);
  host._appShellState = new AppShellStateController(host);
  host._appDataState = new AppDataStateController(host);
  host._appEventsState = new AppEventsStateController(host);

  host._handleSearchSortChanged = (event) =>
    host._searchState.handleSortChanged(event.detail || {});

  host._handleSearchOptimisticRemove = (event) =>
    host._searchState.handleOptimisticRemove(event.detail || {});
}
