import { Injectable } from '@angular/core';
import {
	AbstractFacadeService,
	ApiRunner,
	AppInjector,
	OverwolfService,
	WindowManagerService,
} from '@firestone/shared/framework/core';
import { CurrentPlan, OwSub, PremiumPlanId } from './subscription.service';

const UNSUB_URL = 'https://56ogovbpuj3wqndoj6j3fv3qs40ustlm.lambda-url.us-west-2.on.aws/';
const STATUS_URL = 'https://kb3ek7w47ofny2lhrnv7xlmxnq0ifkbj.lambda-url.us-west-2.on.aws/';

@Injectable()
export class OwLegacyPremiumService extends AbstractFacadeService<OwLegacyPremiumService> {
	private initialized = false;

	private api: ApiRunner;
	private ow: OverwolfService;

	constructor(protected override readonly windowManager: WindowManagerService) {
		super(windowManager, 'owLegacyPremium', () => this.initialized);
	}

	protected override assignSubjects() {
		this.initialized = true;
		// this.packages$$ = this.mainInstance.packages$$;
	}

	protected async init() {
		this.api = AppInjector.get(ApiRunner);
		this.ow = AppInjector.get(OverwolfService);
	}

	public async getSubscriptionStatus(): Promise<CurrentPlan | null> {
		return this.mainInstance.getSubscriptionStatusInternal();
	}

	public async subscribe() {
		return this.mainInstance.subscribeInternal();
	}

	private async subscribeInternal() {
		this.ow.openStore();
	}

	public async unsubscribe() {
		return this.mainInstance.unsubscribeInternal();
	}

	private async getSubscriptionStatusInternal(): Promise<CurrentPlan | null> {
		const legacyPlans = await this.ow.getActiveSubscriptionPlans();
		console.debug('[ads] [ow-legacy-premium] legacy plans', legacyPlans);
		if (!legacyPlans?.plans?.length) {
			return null;
		}
		// User has a plan, and we use this endpoint to get the expiry date
		const owToken = await this.ow.generateSessionToken();
		const legacyPlan = await this.api.callPostApi<OwSub>(STATUS_URL, {
			owToken: owToken,
		});
		console.log('[ads] [ow-legacy-premium] sub status', legacyPlan);
		if (legacyPlan?.state === 0 || (legacyPlan?.state === 1 && new Date(legacyPlan.expireAt) >= new Date())) {
			const result = {
				id: 'legacy' as PremiumPlanId,
				expireAt: legacyPlan.expireAt,
				active: true,
				autoRenews: legacyPlan.state === 0,
				cancelled: legacyPlan.state === 1,
			};
			console.debug('[ads] [ow-legacy-premium] return legacy plan', result);
			return result;
		}
		return null;
	}

	private async unsubscribeInternal() {
		const owToken = await this.ow.generateSessionToken();
		const unsubResult = await this.api.callPostApi(UNSUB_URL, {
			owToken: owToken,
		});
		console.log('[ads] [ow-legacy-premium] unsub result', unsubResult);
		console.debug('[ads] [ow-legacy-premium] should show ads now?');
		return unsubResult;
	}
}
