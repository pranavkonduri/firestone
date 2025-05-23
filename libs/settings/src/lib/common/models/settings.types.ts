import { ArenaRewardsService } from '@firestone/arena/common';
import { ICollectionPackService } from '@firestone/collection/common';
import { AccountService } from '@firestone/profile/common';
import { DiskCacheService, Preferences, PreferencesService } from '@firestone/shared/common/service';
import { Knob } from '@firestone/shared/common/view';
import {
	AnalyticsService,
	CardsFacadeService,
	IAdsService,
	ILocalizationService,
	IndexedDbService,
	OverwolfService,
} from '@firestone/shared/framework/core';
import { GameStatsLoaderService } from '@firestone/stats/data-access';
import { Observable } from 'rxjs';
import { SettingsControllerService } from '../services/settings-controller.service';

export interface SettingContext {
	readonly prefs: PreferencesService;
	readonly analytics: AnalyticsService;
	readonly ow: OverwolfService;
	readonly i18n: ILocalizationService;
	readonly adService: IAdsService;
	readonly allCards: CardsFacadeService;
	readonly isBeta: boolean;
	readonly services: {
		readonly diskCache: DiskCacheService;
		readonly db: IndexedDbService;
		readonly gamesLoader: GameStatsLoaderService;
		readonly packService: ICollectionPackService;
		readonly arenaRewards: ArenaRewardsService;
		readonly settingsController: SettingsControllerService;
		readonly account: AccountService;
	};
}

export interface SettingNode {
	readonly id: string;
	readonly name: string;
	readonly cssClass?: string;
	readonly keywords?: readonly string[] | null;
	readonly children: readonly SettingNode[] | null;
	readonly sections?: readonly (Section | SectionReference)[];
}

// Not sure how to do this, but the idea is to simply specify a manually crafted component that we insert
export interface SectionReference {
	readonly id: string;
	readonly componentType: SettingsSectionReferenceType;
}
export type SettingsSectionReferenceType =
	| 'AppearanceCustomizationPageComponent'
	| 'SettingsGeneralBugReportComponent'
	| 'SettingsGeneralThirdPartyComponent'
	| 'SettingsDiscordComponent'
	| 'SettingsGeneralModsComponent'
	| 'SettingsBroadcastComponent';

export interface Section {
	readonly id: string;
	readonly title: string | null;
	readonly keywords?: readonly string[] | null;
	readonly texts?: readonly (string | Observable<string>)[]; // Raw HTML
	readonly settings?: readonly (Setting | SettingButton)[];
	readonly disabled$?: () => Observable<boolean>;
	// TODO: how to handle the buttons that let you reset the widget positions?
	readonly buttons?: readonly SettingButton[];
	// need text, tooltip, action, confirmation
}

export interface SettingButton {
	readonly label?: string;
	readonly text: string | Observable<string>;
	readonly tooltip: string | null;
	readonly action: () => void | PromiseLike<void>;
	readonly confirmation?: string;
	readonly keywords?: readonly string[] | null;
}

export interface Setting {
	readonly type: 'toggle' | 'toggle-ynlimited' | 'dropdown' | 'slider' | 'text-input' | 'numeric-input';
	readonly field: keyof Preferences;
	readonly label: string | null;
	readonly tooltip: string | null;
	// E.g. if a setting can only be activated when the parent is on, and we want to display them as indented below them
	// readonly childSettings?: readonly Setting[];
	readonly disabledIf?: (prefs: Preferences, premium: boolean) => boolean;
	readonly keywords?: readonly string[] | null;
	readonly advancedSetting?: boolean;
	readonly premiumSetting?: boolean;

	readonly toggleConfig?: ToggleConfig;
	readonly dropdownConfig?: DropdownConfig;
	readonly sliderConfig?: SliderConfig;
	readonly textInputConfig?: TextInputConfig;
	readonly numericConfig?: NumericInputConfig;
}

export interface ToggleConfig {
	readonly messageWhenToggleValue?: string;
	readonly valueToDisplayMessageOn?: string | boolean;
	readonly toggleFunction?: (newValue: boolean) => void;
}

export interface DropdownConfig {
	readonly afterSelection?: (newValue: string) => void;
	readonly options: readonly DropdownOption[];
}

export interface DropdownOption {
	readonly value: string;
	readonly label: string;
	readonly disabled?: boolean;
}
export interface SliderConfig {
	readonly min: number;
	readonly max: number;
	readonly snapSensitivity: number;
	readonly showCurrentValue?: boolean;
	readonly displayedValueUnit?: string;
	readonly knobs?: readonly Knob[];
}
export interface TextInputConfig {
	readonly onInputUpdate: (value: string, context: SettingContext) => void;
}

export interface NumericInputConfig {
	readonly minValue?: number;
	readonly incrementStep?: number;
}
