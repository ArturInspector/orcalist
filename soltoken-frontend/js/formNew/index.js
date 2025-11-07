import {handleStepOne} from './stepOne.js';
import {handleStepTwo} from './stepTwo.js';
import {handleStepThree} from './stepThree.js';
import {modalAddress} from "./modalAddress.js";

const formData = {
  tokenName: '',
  tokenSymbol: '',
  tokenLogo: null,
  decimals: '',
  supply: '',
  description: '',
  website: '',
  twitter: '',
  telegram: '',
  discord: '',
  creatorName: '',
  creatorWebsite: '',
  totalCost: 0,
  modifications: {
    modifyCreator: false,
    revokeFreeze: false,
    revokeMint: false,
    revokeUpdate: false,
  }
};

handleStepOne(formData);
handleStepTwo(formData);
handleStepThree(formData);
modalAddress();